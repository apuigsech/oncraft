import type { StreamMessage, SessionConfig, AgentProgressEvent } from '~/types';
import {
  spawnSession, sendStart, sendReply, interrupt, killProcess,
  isProcessActive, isQueryActive, markQueryComplete,
  onMessage, offMessage,
  listCommandsNative, loadHistoryViaSidecar,
} from '~/services/claude-process';
import { ensureMarkdownReady } from '~/services/markdown';

export const useSessionsStore = defineStore('sessions', () => {
  const messages: Record<string, StreamMessage[]> = reactive({});
  const activeChatCardId = ref<string | null>(null);
  const historyLoaded = new Set<string>();
  const sessionConfigs: Record<string, SessionConfig> = reactive({});
  const availableCommands = ref<{ name: string; desc: string; source?: string }[]>([]);
  const sessionMetrics: Record<string, { inputTokens: number; outputTokens: number; costUsd: number; durationMs: number }> = reactive({});
  const progressEvents: Record<string, AgentProgressEvent[]> = reactive({});

  // ME-3: Maximum messages kept in memory per card.
  // Older messages are discarded to prevent unbounded memory growth in long sessions.
  const MAX_MESSAGES_PER_CARD = 500;
  const MAX_PROGRESS_EVENTS_PER_CARD = 50;

  // QW-3: Buffer streaming tokens and flush via requestAnimationFrame
  // instead of mutating reactive state on every single token arrival
  const _streamingBuffers = new Map<string, string>();
  const _streamingRafPending = new Set<string>();

  function _flushStreamingBuffer(cardId: string): void {
    const buffered = _streamingBuffers.get(cardId);
    if (!buffered) return;
    _streamingBuffers.delete(cardId);
    _streamingRafPending.delete(cardId);

    const msgs = messages[cardId];
    if (!msgs?.length) return;
    const last = msgs[msgs.length - 1];
    if (last?.type === 'assistant' && last.subtype === 'streaming') {
      last.content += buffered;
    }
  }

  function _bufferStreamingToken(cardId: string, token: string): void {
    const existing = _streamingBuffers.get(cardId) || '';
    _streamingBuffers.set(cardId, existing + token);

    if (!_streamingRafPending.has(cardId)) {
      _streamingRafPending.add(cardId);
      requestAnimationFrame(() => _flushStreamingBuffer(cardId));
    }
  }

  function getProgressEvents(cardId: string): AgentProgressEvent[] {
    return progressEvents[cardId] || [];
  }

  function getSessionMetrics(cardId: string) {
    if (!sessionMetrics[cardId]) {
      sessionMetrics[cardId] = { inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: 0 };
    }
    return sessionMetrics[cardId];
  }

  function getSessionConfig(cardId: string): SessionConfig {
    if (!sessionConfigs[cardId]) {
      sessionConfigs[cardId] = { model: 'sonnet', effort: 'high', permissionMode: 'default', verbosity: 'normal' };
    }
    return sessionConfigs[cardId];
  }

  function updateSessionConfig(cardId: string, partial: Partial<SessionConfig>): void {
    const config = getSessionConfig(cardId);
    Object.assign(config, partial);
  }

  function getMessages(cardId: string): StreamMessage[] {
    return messages[cardId] || [];
  }

  function appendMessage(cardId: string, msg: StreamMessage): void {
    if (!messages[cardId]) { messages[cardId] = []; }
    if (msg.type === 'system' && !msg.content && !msg.sessionId) return;

    // QW-3: Streaming tokens are buffered and flushed via rAF
    // to avoid mutating reactive state on every single token (~10-20/s)
    if (msg.subtype === 'streaming' && msg.type === 'assistant') {
      const msgs = messages[cardId];
      const last = msgs.length > 0 ? msgs[msgs.length - 1] : null;
      if (last && last.type === 'assistant' && last.subtype === 'streaming') {
        _bufferStreamingToken(cardId, msg.content);
        return;
      }
    }

    // Tool results: merge into the matching tool_use message instead of adding separately
    if (msg.type === 'tool_result' && msg.toolUseId) {
      const msgs = messages[cardId];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].type === 'tool_use' && msgs[i].toolUseId === msg.toolUseId) {
          msgs[i].toolResult = msg.toolResult || (msg as { content?: string }).content || '';
          return;
        }
      }
      // No matching tool_use found, skip
      return;
    }

    // When a complete assistant message arrives after streaming, flush buffer and replace
    if (msg.type === 'assistant' && !msg.subtype) {
      // QW-3: Flush any pending streaming buffer before replacing
      _flushStreamingBuffer(cardId);
      const msgs = messages[cardId];
      const lastIdx = msgs.length - 1;
      if (lastIdx >= 0 && msgs[lastIdx].type === 'assistant' && msgs[lastIdx].subtype === 'streaming') {
        msgs[lastIdx] = msg; // Replace streaming with final
        return;
      }
    }

    messages[cardId].push(msg);

    // ME-3: Trim old messages to prevent unbounded memory growth
    if (messages[cardId].length > MAX_MESSAGES_PER_CARD) {
      messages[cardId] = messages[cardId].slice(-MAX_MESSAGES_PER_CARD);
    }
  }

  function setupMessageListener(cardId: string): void {
    onMessage(cardId, (msg: StreamMessage) => {
      const cardsStore = useCardsStore();

      // Capture session ID and git branch from init or result messages
      if (msg.sessionId) {
        cardsStore.updateCardSessionId(cardId, msg.sessionId);
      }
      if (msg.subtype === 'init') {
        const initData = msg as unknown as Record<string, unknown>;
        if (initData.gitBranch) {
          updateSessionConfig(cardId, { gitBranch: initData.gitBranch as string });
        }
      }

      // Accumulate usage metrics from assistant messages
      if (msg.type === 'assistant' && msg.usage) {
        const m = getSessionMetrics(cardId);
        m.inputTokens += msg.usage.inputTokens || 0;
        m.outputTokens += msg.usage.outputTokens || 0;
      }

      // On result message, capture cost/duration and mark query complete
      if (msg.subtype === 'result') {
        const m = getSessionMetrics(cardId);
        if (msg.costUsd) m.costUsd += msg.costUsd;
        if (msg.durationMs) m.durationMs += msg.durationMs;
        if (msg.usage) {
          m.inputTokens = msg.usage.inputTokens || m.inputTokens;
          m.outputTokens = msg.usage.outputTokens || m.outputTokens;
        }
        markQueryComplete(cardId);
        cardsStore.updateCardState(cardId, 'idle');
        if (!msg.content) return;
      }

      // On error, mark query complete and set card to error state
      if (msg.subtype === 'error') {
        markQueryComplete(cardId);
        cardsStore.updateCardState(cardId, 'error');
      }

      appendMessage(cardId, msg);
    });
  }

  async function send(cardId: string, message: string, images?: import('~/types').ImageAttachment[]): Promise<void> {
    const cardsStore = useCardsStore();
    const card = cardsStore.cards.find(c => c.id === cardId);

    appendMessage(cardId, { type: 'user', content: message, timestamp: Date.now(), ...(images?.length ? { images } : {}) });

    // Block only if a query is actively running (not just sidecar alive)
    if (isQueryActive(cardId)) {
      appendMessage(cardId, { type: 'system', content: 'Waiting for current response to finish...', timestamp: Date.now() });
      return;
    }

    const project = useProjectsStore().activeProject;
    if (!project) return;

    await cardsStore.updateCardState(cardId, 'active');

    // Determine session ID for resume
    const sessionId = card?.sessionId && !card.sessionId.startsWith('pending-')
      ? card.sessionId : undefined;

    const config = getSessionConfig(cardId);

    // Ensure worktreeName from card is reflected in session config
    if (card?.useWorktree && card.worktreeName && !config.worktreeName) {
      config.worktreeName = card.worktreeName;
    }

    // If sidecar is already alive (previous query completed), reuse it
    if (isProcessActive(cardId)) {
      try {
        await sendStart(cardId, project.path, message, sessionId, config, images);
      } catch (err) {
        appendMessage(cardId, { type: 'system', content: `Error: ${err}`, timestamp: Date.now() });
        await cardsStore.updateCardState(cardId, 'idle');
      }
    } else {
      // No sidecar running — spawn a new one
      setupMessageListener(cardId);
      try {
        await spawnSession(cardId, project.path, message, sessionId, config, images);
      } catch (err) {
        appendMessage(cardId, { type: 'system', content: `Error: ${err}`, timestamp: Date.now() });
        await cardsStore.updateCardState(cardId, 'idle');
        offMessage(cardId);
      }
    }
  }

  async function approveToolUse(cardId: string): Promise<void> {
    await sendReply(cardId, 'allow');
  }

  async function rejectToolUse(cardId: string): Promise<void> {
    await sendReply(cardId, 'deny');
  }

  async function interruptSession(cardId: string): Promise<void> {
    await interrupt(cardId);
  }

  async function stopSession(cardId: string): Promise<void> {
    offMessage(cardId);
    await killProcess(cardId);
    const cardsStore = useCardsStore();
    await cardsStore.updateCardState(cardId, 'idle');
  }

  async function loadAvailableCommands(projectPath?: string): Promise<void> {
    // DA-1: Uses native Rust command instead of sidecar
    const cmds = await listCommandsNative(projectPath);
    if (import.meta.dev) console.log('[OnCraft] loaded', cmds.length, 'commands from filesystem');
    availableCommands.value = cmds;
  }

  async function openChat(cardId: string): Promise<void> {
    activeChatCardId.value = cardId;

    // ME-5: Eagerly init markdown engine when chat opens (lazy-loaded deps)
    ensureMarkdownReady();

    // Load available commands if we haven't yet
    if (availableCommands.value.length === 0) {
      const project = useProjectsStore().activeProject;
      if (project) {
        loadAvailableCommands(project.path);
      }
    }

    // Load history in background — don't block the chat panel from appearing.
    // The panel renders immediately (empty or with cached messages) and
    // history arrives asynchronously, triggering a reactive update.
    if (!historyLoaded.has(cardId) && (!messages[cardId] || messages[cardId].length === 0)) {
      historyLoaded.add(cardId); // Mark immediately to prevent duplicate loads
      const cardsStore = useCardsStore();
      const card = cardsStore.cards.find(c => c.id === cardId);
      if (card?.sessionId && !card.sessionId.startsWith('pending-')) {
        if (import.meta.dev) console.log('[OnCraft] loading history for session:', card.sessionId);
        loadHistoryViaSidecar(card.sessionId).then((history) => {
          if (import.meta.dev) console.log('[OnCraft] loaded', history.length, 'messages from history');
          if (history.length > 0) {
            messages[cardId] = history;
          }
        });
      }
    }
  }
  function closeChat(): void { activeChatCardId.value = null; }
  function isActive(cardId: string): boolean { return isQueryActive(cardId); }

  // ME-3: Purge in-memory messages for a card (e.g. when archived or removed)
  function purgeCard(cardId: string): void {
    delete messages[cardId];
    delete sessionConfigs[cardId];
    delete sessionMetrics[cardId];
    delete progressEvents[cardId];
    historyLoaded.delete(cardId);
    _streamingBuffers.delete(cardId);
    _streamingRafPending.delete(cardId);
  }

  return {
    messages, activeChatCardId, sessionConfigs, sessionMetrics, availableCommands, progressEvents,
    getMessages, getSessionConfig, updateSessionConfig, getSessionMetrics, getProgressEvents,
    send, approveToolUse, rejectToolUse,
    loadAvailableCommands, interruptSession, stopSession, openChat, closeChat, isActive, purgeCard,
  };
});
