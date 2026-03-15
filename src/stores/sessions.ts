import { defineStore } from 'pinia';
import { ref, reactive } from 'vue';
import type { StreamMessage, SessionConfig } from '../types';
import {
  spawnSession, sendStart, sendReply, interrupt, killProcess,
  isProcessActive, isQueryActive, markQueryComplete,
  onMessage, offMessage,
} from '../services/claude-process';
import { useCardsStore } from './cards';

export const useSessionsStore = defineStore('sessions', () => {
  const messages: Record<string, StreamMessage[]> = reactive({});
  const activeChatCardId = ref<string | null>(null);
  const historyLoaded = new Set<string>();
  const sessionConfigs: Record<string, SessionConfig> = reactive({});
  const sessionMetrics: Record<string, { inputTokens: number; outputTokens: number; costUsd: number; durationMs: number }> = reactive({});

  function getSessionMetrics(cardId: string) {
    if (!sessionMetrics[cardId]) {
      sessionMetrics[cardId] = { inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: 0 };
    }
    return sessionMetrics[cardId];
  }

  function getSessionConfig(cardId: string): SessionConfig {
    if (!sessionConfigs[cardId]) {
      sessionConfigs[cardId] = { model: 'sonnet', effort: 'high', permissionMode: 'default' };
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

    // Streaming: append text to the last streaming assistant message
    if (msg.subtype === 'streaming' && msg.type === 'assistant') {
      const msgs = messages[cardId];
      const last = msgs.length > 0 ? msgs[msgs.length - 1] : null;
      if (last && last.type === 'assistant' && last.subtype === 'streaming') {
        last.content += msg.content;
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

    // When a complete assistant message arrives after streaming, replace the streaming one
    if (msg.type === 'assistant' && !msg.subtype) {
      const msgs = messages[cardId];
      const lastIdx = msgs.length - 1;
      if (lastIdx >= 0 && msgs[lastIdx].type === 'assistant' && msgs[lastIdx].subtype === 'streaming') {
        msgs[lastIdx] = msg; // Replace streaming with final
        return;
      }
    }

    messages[cardId].push(msg);
  }

  function setupMessageListener(cardId: string): void {
    onMessage(cardId, (msg: StreamMessage) => {
      const cardsStore = useCardsStore();

      // Capture session ID and git branch from init or result messages
      if (msg.sessionId) {
        cardsStore.updateCardSessionId(cardId, msg.sessionId);
      }
      if (msg.subtype === 'init' && (msg as unknown as Record<string, unknown>).gitBranch) {
        updateSessionConfig(cardId, { gitBranch: (msg as unknown as Record<string, unknown>).gitBranch as string });
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

  async function send(cardId: string, message: string): Promise<void> {
    const cardsStore = useCardsStore();
    const card = cardsStore.cards.find(c => c.id === cardId);

    appendMessage(cardId, { type: 'user', content: message, timestamp: Date.now() });

    // Block only if a query is actively running (not just sidecar alive)
    if (isQueryActive(cardId)) {
      appendMessage(cardId, { type: 'system', content: 'Waiting for current response to finish...', timestamp: Date.now() });
      return;
    }

    const project = (await import('./projects')).useProjectsStore().activeProject;
    if (!project) return;

    await cardsStore.updateCardState(cardId, 'active');

    // Determine session ID for resume
    const sessionId = card?.sessionId && !card.sessionId.startsWith('pending-')
      ? card.sessionId : undefined;

    const config = getSessionConfig(cardId);

    // If sidecar is already alive (previous query completed), reuse it
    if (isProcessActive(cardId)) {
      try {
        await sendStart(cardId, project.path, message, sessionId, config);
      } catch (err) {
        appendMessage(cardId, { type: 'system', content: `Error: ${err}`, timestamp: Date.now() });
        await cardsStore.updateCardState(cardId, 'idle');
      }
    } else {
      // No sidecar running — spawn a new one
      setupMessageListener(cardId);
      try {
        await spawnSession(cardId, project.path, message, sessionId, config);
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

  async function openChat(cardId: string): Promise<void> {
    activeChatCardId.value = cardId;

    // Load history via sidecar SDK if we haven't already
    if (!historyLoaded.has(cardId) && (!messages[cardId] || messages[cardId].length === 0)) {
      const cardsStore = useCardsStore();
      const card = cardsStore.cards.find(c => c.id === cardId);
      if (card?.sessionId && !card.sessionId.startsWith('pending-')) {
        console.log('[ClaudBan] loading history for session:', card.sessionId);
        const { loadHistoryViaSidecar } = await import('../services/claude-process');
        const history = await loadHistoryViaSidecar(card.sessionId);
        console.log('[ClaudBan] loaded', history.length, 'messages from history');
        if (history.length > 0) {
          messages[cardId] = history;
        }
      }
      historyLoaded.add(cardId);
    }
  }
  function closeChat(): void { activeChatCardId.value = null; }
  function isActive(cardId: string): boolean { return isQueryActive(cardId); }

  return {
    messages, activeChatCardId, sessionConfigs, sessionMetrics,
    getMessages, getSessionConfig, updateSessionConfig, getSessionMetrics,
    send, approveToolUse, rejectToolUse,
    interruptSession, stopSession, openChat, closeChat, isActive,
  };
});
