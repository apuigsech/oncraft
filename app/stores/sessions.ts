import type { ChatPart, SidecarMessage, SessionConfig } from '~/types';
import {
  spawnSession, sendStart, sendReply, interrupt, killProcess,
  isProcessActive, isQueryActive, markQueryComplete,
  listActiveProcessCardIds, killAllProcesses, shutdownUtilSidecar,
  onMessage, offMessage, onMeta, offMeta,
  listCommandsNative, loadHistoryViaSidecar,
} from '~/services/claude-process';
import { resolveTemplate } from '~/services/template-engine';
import { ensureMarkdownReady } from '~/services/markdown';
import { trackSessionStart, trackSessionEnd } from '~/services/telemetry';
import { perfEnd, perfStart } from '~/services/perf';

export const useSessionsStore = defineStore('sessions', () => {
  const messages: Record<string, ChatPart[]> = reactive({});

  // NAV: Per-project active chat — each project remembers which card's chat was open
  const activeChatCardByProject = reactive(new Map<string, string>());
  const activeChatCardId = computed<string | null>(() => {
    const projectsStore = useProjectsStore();
    if (!projectsStore.isProjectTab) return null;
    const projectId = projectsStore.activeProjectId;
    if (!projectId) return null;
    return activeChatCardByProject.get(projectId) ?? null;
  });

  const historyLoaded = new Set<string>();
  const _loadingHistory = shallowRef(new Set<string>());
  const sessionConfigs: Record<string, SessionConfig> = reactive({});
  const availableCommands = ref<{ name: string; desc: string; source?: string }[]>([]);
  const sessionMetrics: Record<string, { inputTokens: number; outputTokens: number; costUsd: number; durationMs: number }> = reactive({});

  // NAV: Track cardId → projectId for cross-project activity indicators
  const cardProjectMap = reactive(new Map<string, string>());

  const _activeProjects = computed(() => {
    const active = new Set<string>();
    for (const [cardId, pid] of cardProjectMap) {
      if (isQueryActive(cardId)) active.add(pid);
    }
    return active;
  });

  function hasActiveCards(projectId: string): boolean {
    return _activeProjects.value.has(projectId);
  }

  // Track active sub-agents per card (task_started adds, result/notification removes)
  const activeSubAgents: Record<string, Set<string>> = reactive({});

  // Per-query tracking: start time, token accumulation, sub-agent timestamps
  const queryTracking: Record<string, {
    startedAt: number;
    outputTokens: number;
    subAgentStartTimes: Record<string, number>;
  }> = reactive({});

  // HOME: Track current tool per active session for Activity panel
  const activeToolByCard = reactive(new Map<string, { toolName: string; toolContext: string }>());
  // HOME: Track cards needing attention (approval, error, rate_limit)
  const cardAttentionState = reactive(new Map<string, 'approval' | 'error' | 'rate_limit'>());

  // ME-3: Maximum messages kept in memory per card.
  // Older messages are discarded to prevent unbounded memory growth in long sessions.
  const MAX_MESSAGES_PER_CARD = 500;

  // QW-3: Buffer streaming tokens and flush via requestAnimationFrame
  // instead of mutating reactive state on every single token arrival
  const _streamingBuffers = new Map<string, string>();
  const _streamingRafPending = new Set<string>();
  const _streamingTokenCount = new Map<string, number>();
  const _thinkingBuffers = new Map<string, string>();
  const _thinkingRafPending = new Set<string>();

  function _flushStreamingBuffer(cardId: string): void {
    const flushStart = perfStart('stream.flushText');
    const buffered = _streamingBuffers.get(cardId);
    if (!buffered) return;
    _streamingBuffers.delete(cardId);
    _streamingRafPending.delete(cardId);

    const msgs = messages[cardId];
    if (!msgs?.length) return;
    const last = msgs[msgs.length - 1];
    if (last?.kind === 'assistant' && last.data.streaming) {
      last.data.content = (last.data.content as string) + buffered;
    }
    perfEnd('stream.flushText', flushStart, {
      cardId,
      chars: buffered.length,
      tokensSeen: _streamingTokenCount.get(cardId) || 0,
    });
    _streamingTokenCount.delete(cardId);
  }

  function _bufferStreamingToken(cardId: string, token: string): void {
    const existing = _streamingBuffers.get(cardId) || '';
    _streamingBuffers.set(cardId, existing + token);
    _streamingTokenCount.set(cardId, (_streamingTokenCount.get(cardId) || 0) + 1);

    if (!_streamingRafPending.has(cardId)) {
      _streamingRafPending.add(cardId);
      requestAnimationFrame(() => _flushStreamingBuffer(cardId));
    }
  }

  function _flushThinkingBuffer(cardId: string): void {
    const buffered = _thinkingBuffers.get(cardId);
    if (!buffered) return;
    _thinkingBuffers.delete(cardId);
    _thinkingRafPending.delete(cardId);

    const msgs = messages[cardId];
    if (!msgs?.length) return;
    const last = msgs[msgs.length - 1];
    if (last?.kind === 'assistant' && last.data.thinkingStreaming) {
      last.data.content = (last.data.content as string) + buffered;
    }
  }

  function _bufferThinkingToken(cardId: string, token: string): void {
    const existing = _thinkingBuffers.get(cardId) || '';
    _thinkingBuffers.set(cardId, existing + token);
    if (!_thinkingRafPending.has(cardId)) {
      _thinkingRafPending.add(cardId);
      requestAnimationFrame(() => _flushThinkingBuffer(cardId));
    }
  }

  function getSessionMetrics(cardId: string) {
    if (!sessionMetrics[cardId]) {
      sessionMetrics[cardId] = { inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: 0 };
    }
    return sessionMetrics[cardId];
  }

  function getSessionConfig(cardId: string): SessionConfig {
    if (!sessionConfigs[cardId]) {
      const settingsStore = useSettingsStore();
      sessionConfigs[cardId] = {
        model: settingsStore.settings.defaultModel || 'sonnet',
        effort: settingsStore.settings.defaultEffort || 'high',
        permissionMode: settingsStore.settings.defaultPermissionMode || 'default',
        verbosity: 'normal',
      };
    }
    return sessionConfigs[cardId];
  }

  function updateSessionConfig(cardId: string, partial: Partial<SessionConfig>): void {
    const config = getSessionConfig(cardId);
    Object.assign(config, partial);
  }

  function getMessages(cardId: string): ChatPart[] {
    return messages[cardId] || [];
  }

  function getActiveSubAgentCount(cardId: string): number {
    return activeSubAgents[cardId]?.size ?? 0;
  }

  function getQueryTracking(cardId: string) {
    return queryTracking[cardId] ?? null;
  }

  function appendPart(cardId: string, part: ChatPart): void {
    if (!messages[cardId]) { messages[cardId] = []; }

    // Track sub-agent lifecycle via task events
    if (part.kind === 'task_started' && part.data.taskId) {
      if (!activeSubAgents[cardId]) activeSubAgents[cardId] = new Set();
      activeSubAgents[cardId].add(part.data.taskId as string);
      if (queryTracking[cardId]) {
        queryTracking[cardId].subAgentStartTimes[part.data.taskId as string] = Date.now();
      }
    } else if (part.kind === 'task_notification' && part.data.taskId) {
      activeSubAgents[cardId]?.delete(part.data.taskId as string);
      if (queryTracking[cardId]) {
        delete queryTracking[cardId].subAgentStartTimes[part.data.taskId as string];
      }
    }

    // QW-3: Streaming tokens are buffered and flushed via rAF
    // to avoid mutating reactive state on every single token (~10-20/s)
    if (part.kind === 'assistant' && part.data.streaming) {
      const msgs = messages[cardId];
      const last = msgs.length > 0 ? msgs[msgs.length - 1] : null;
      if (last && last.kind === 'assistant' && last.data.streaming) {
        _bufferStreamingToken(cardId, part.data.content as string);
        return;
      }
    }

    // When a complete assistant message arrives after streaming, flush buffer and replace
    if (part.kind === 'assistant' && !part.data.streaming) {
      _flushStreamingBuffer(cardId);
      _flushThinkingBuffer(cardId);
      const msgs = messages[cardId];
      const lastIdx = msgs.length - 1;
      if (lastIdx >= 0 && msgs[lastIdx]!.kind === 'assistant' && msgs[lastIdx]!.data.streaming) {
        msgs[lastIdx] = part; // Replace text streaming with final
        return;
      }
      // Replace thinking streaming part with complete thinking block
      if (part.data.thinking && lastIdx >= 0 && msgs[lastIdx]!.kind === 'assistant' && msgs[lastIdx]!.data.thinkingStreaming) {
        msgs[lastIdx] = part;
        return;
      }
    }

    messages[cardId].push(part);

    // ME-3: Trim old messages to prevent unbounded memory growth
    if (messages[cardId].length > MAX_MESSAGES_PER_CARD) {
      messages[cardId] = messages[cardId].slice(-MAX_MESSAGES_PER_CARD);
    }
  }

  function handleMeta(cardId: string, msg: SidecarMessage): void {
    const cardsStore = useCardsStore();

    // result: extract metrics, capture sessionId, mark query complete, update card state
    if (msg.type === 'result') {
      if (msg.sessionId) {
        cardsStore.updateCardSessionId(cardId, msg.sessionId as string);
      }
      const m = getSessionMetrics(cardId);
      if (msg.costUsd) m.costUsd += msg.costUsd as number;
      if (msg.durationMs) m.durationMs += msg.durationMs as number;
      if (msg.usage) {
        const usage = msg.usage as { inputTokens?: number; outputTokens?: number };
        m.inputTokens += usage.inputTokens || 0;
        m.outputTokens += usage.outputTokens || 0;
        // Overwrite estimated tokens with real count from SDK
        if (queryTracking[cardId] && usage.outputTokens) {
          queryTracking[cardId].outputTokens = usage.outputTokens;
        }
      }
      // Persist accumulated metrics to SQLite via cards store
      cardsStore.updateCardMetrics(cardId, {
        costUsd: m.costUsd,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        durationMs: m.durationMs,
      });
      // Telemetry: track session end with duration (anonymous, no card/project data)
      trackSessionEnd((msg.durationMs as number) || 0);
      markQueryComplete(cardId);
      delete activeSubAgents[cardId]; // Clear sub-agent tracking on query end
      // HOME: Clear live tool and attention state on query end
      activeToolByCard.delete(cardId);
      cardAttentionState.delete(cardId);
      cardsStore.updateCardState(cardId, 'idle');
      return;
    }

    // init: extract sessionId, gitBranch, worktree info
    if (msg.type === 'init') {
      if (msg.sessionId) {
        cardsStore.updateCardSessionId(cardId, msg.sessionId as string);
      }
      const partial: Partial<SessionConfig> = {};
      if (msg.gitBranch) partial.gitBranch = msg.gitBranch as string;
      if (msg.worktreePath) partial.worktreePath = msg.worktreePath as string;
      if (msg.worktreeBranch) partial.worktreeBranch = msg.worktreeBranch as string;
      if (Object.keys(partial).length > 0) {
        updateSessionConfig(cardId, partial);
      }
      // Sync card worktreeName with actual directory created by CLI
      if (msg.worktreePath) {
        const actualName = (msg.worktreePath as string).split('/').pop() || '';
        const card = cardsStore.cards.find(c => c.id === cardId);
        if (card && card.worktreeName && card.worktreeName !== actualName && actualName) {
          cardsStore.updateCardWorktreeName(cardId, actualName);
        }
      }
      return;
    }

    // session_died: SDK session crashed (e.g. CLI exited with non-zero code)
    // Clean up query state so the card isn't stuck in 'active' forever.
    if (msg.type === 'session_died') {
      markQueryComplete(cardId);
      delete activeSubAgents[cardId];
      activeToolByCard.delete(cardId);
      cardsStore.updateCardState(cardId, 'error');
      return;
    }

    // session_state_changed: authoritative state from SDK
    if (msg.type === 'session_state_changed') {
      const state = msg.state as string;
      if (state === 'idle') {
        cardsStore.updateCardState(cardId, 'idle');
      } else if (state === 'running') {
        cardsStore.updateCardState(cardId, 'active');
      }
      return;
    }

    // streaming delta: buffer the token
    if (msg.type === 'assistant' && msg.subtype === 'streaming') {
      if (!messages[cardId]) { messages[cardId] = []; }
      const msgs = messages[cardId];
      const last = msgs.length > 0 ? msgs[msgs.length - 1] : null;
      if (!last || last.kind !== 'assistant' || !last.data.streaming) {
        // Create a new streaming ChatPart
        msgs.push({
          id: 'assistant-streaming',
          kind: 'assistant',
          placement: 'inline',
          timestamp: Date.now(),
          data: { content: '', streaming: true, parentToolUseId: msg.parentToolUseId ?? null },
        });
      }
      const token = (msg.content as string) || '';
      _bufferStreamingToken(cardId, token);
      // Estimate output tokens (~4 chars per token)
      if (queryTracking[cardId] && token.length > 0) {
        queryTracking[cardId].outputTokens += Math.max(1, Math.ceil(token.length / 4));
      }
      return;
    }

    // thinking streaming delta: buffer into a thinking ChatPart
    if (msg.type === 'assistant' && msg.subtype === 'thinking_streaming') {
      if (!messages[cardId]) { messages[cardId] = []; }
      const msgs = messages[cardId];
      const last = msgs.length > 0 ? msgs[msgs.length - 1] : null;
      if (!last || last.kind !== 'assistant' || !last.data.thinkingStreaming) {
        // Create a new streaming thinking ChatPart
        msgs.push({
          id: 'thinking-streaming',
          kind: 'assistant',
          placement: 'inline',
          timestamp: Date.now(),
          data: { content: '', thinking: true, thinkingStreaming: true, parentToolUseId: msg.parentToolUseId ?? null },
        });
      }
      // Buffer thinking tokens and flush with requestAnimationFrame
      const token = (msg.content as string) || '';
      _bufferThinkingToken(cardId, token);
      return;
    }

    // HOME: Track current tool for Activity panel
    if (msg.type === 'tool_use') {
      const toolName = (msg.toolName as string) || 'Tool';
      const input = msg.toolInput as Record<string, unknown> | undefined;
      let context = '';
      if (toolName === 'Bash' || toolName === 'bash') {
        context = (input?.command as string)?.slice(0, 60) || '';
      } else if (toolName === 'Edit' || toolName === 'edit' || toolName === 'Write' || toolName === 'write') {
        context = (input?.file_path as string)?.split('/').pop() || '';
      } else if (toolName === 'Read' || toolName === 'read') {
        context = (input?.file_path as string)?.split('/').pop() || '';
      } else {
        context = toolName;
      }
      activeToolByCard.set(cardId, { toolName, toolContext: context });
    }

    // HOME: Track attention-needing states
    if (msg.type === 'tool_confirmation') {
      cardAttentionState.set(cardId, 'approval');
    }
    if (msg.type === 'error') {
      cardAttentionState.set(cardId, 'error');
    }
    if (msg.type === 'system' && (msg.subtype === 'rate_limit' || (msg.content as string)?.includes?.('rate limit'))) {
      cardAttentionState.set(cardId, 'rate_limit');
    }

    // tool_result: merge into matching tool_use part
    if (msg.type === 'tool_result') {
      const parts = messages[cardId];
      if (!parts) return;
      for (let i = parts.length - 1; i >= 0; i--) {
        if ((parts[i]!.kind === 'tool_use' || parts[i]!.kind.startsWith('tool_use:')) && parts[i]!.data.toolUseId === msg.toolUseId) {
          parts[i]!.data.toolResult = (msg.content as string) || (msg.toolResult as string) || '';
          return;
        }
      }
      return;
    }
  }

  function resolveActionPart(cardId: string, partId: string, answer?: string): void {
    const parts = messages[cardId];
    if (!parts) return;
    const part = parts.find(p => p.id === partId);
    if (part) {
      part.resolved = true;
      if (answer !== undefined) part.data.answer = answer;
    }
  }

  function setupMessageListener(cardId: string): void {
    // Normal ChatPart messages
    onMessage(cardId, (part: ChatPart) => {
      appendPart(cardId, part);
    });

    // Meta messages (init, result, streaming, tool_result)
    onMeta(cardId, (msg: SidecarMessage) => {
      handleMeta(cardId, msg);
    });
  }

  async function send(cardId: string, message: string, images?: import('~/types').ImageAttachment[]): Promise<void> {
    const cardsStore = useCardsStore();
    const card = cardsStore.cards.find(c => c.id === cardId);

    appendPart(cardId, {
      id: `user-${Date.now()}`,
      kind: 'user',
      placement: 'inline',
      timestamp: Date.now(),
      data: { content: message, ...(images?.length ? { images } : {}) },
    });

    // Block only if a query is actively running (not just sidecar alive)
    if (isQueryActive(cardId)) {
      appendPart(cardId, {
        id: `system-${Date.now()}`,
        kind: 'system',
        placement: 'inline',
        timestamp: Date.now(),
        data: { content: 'Waiting for current response to finish...' },
      });
      return;
    }

    // Initialize per-query tracking (after confirming no active query)
    queryTracking[cardId] = { startedAt: Date.now(), outputTokens: 0, subAgentStartTimes: {} };

    const project = useProjectsStore().activeProject;
    if (!project) return;

    // NAV: Register card-project association for cross-project activity indicators
    cardProjectMap.set(cardId, project.id);

    await cardsStore.updateCardState(cardId, 'active');
    // Telemetry: track session start (anonymous, no card/project data)
    trackSessionStart();

    // Determine session ID for resume
    let sessionId = card?.sessionId && !card.sessionId.startsWith('pending-')
      ? card.sessionId : undefined;

    // Fork detection: first message on a forked card with no own session yet
    let forkSession = false;
    if (!sessionId && card?.forkedFromId) {
      const parentCard = cardsStore.cards.find(c => c.id === card.forkedFromId);
      if (parentCard?.sessionId && !parentCard.sessionId.startsWith('pending-')) {
        sessionId = parentCard.sessionId;
        forkSession = true;
      }
    }

    const config = getSessionConfig(cardId);

    // Ensure worktreeName from card is reflected in session config
    if (card?.useWorktree && card.worktreeName && !config.worktreeName) {
      config.worktreeName = card.worktreeName;
    }

    // Resolve Flow config for this card's current state (Flow + FlowState layers)
    const flowStore = useFlowStore();
    let flowPayload: import('~/services/claude-process').FlowPayload | undefined;

    if (card && flowStore.flow) {
      const flowConfig = await flowStore.getResolvedConfig(card.columnName, project.path);
      if (flowConfig) {
        // Apply Flow agent defaults under card overrides
        if (!config.model          && flowConfig.agent.model)          config.model          = flowConfig.agent.model;
        if (!config.effort         && flowConfig.agent.effort)         config.effort         = flowConfig.agent.effort;
        if (!config.permissionMode && flowConfig.agent.permissionMode) config.permissionMode = flowConfig.agent.permissionMode;

        flowPayload = {
          systemPromptAppend: flowConfig.systemPromptAppend || undefined,
          allowedTools:       flowConfig.allowedTools.length   ? flowConfig.allowedTools   : undefined,
          disallowedTools:    flowConfig.disallowedTools.length ? flowConfig.disallowedTools : undefined,
          agents: flowConfig.agents.length ? Object.fromEntries(
            flowConfig.agents.map(a => [a.name || a.description.slice(0, 30), {
              description:     a.description,
              prompt:          a.prompt,
              model:           a.model,
              tools:           a.tools,
              disallowedTools: a.disallowedTools,
              skills:          a.skills,
              maxTurns:        a.maxTurns,
            }])
          ) : undefined,
          mcpServers: Object.keys(flowConfig.mcpServers).length ? flowConfig.mcpServers : undefined,
        };
      }
    }

    // If sidecar is already alive (previous query completed), reuse it
    if (isProcessActive(cardId)) {
      try {
        await sendStart(cardId, project.path, message, sessionId, config, images, flowPayload, forkSession);
      } catch (err) {
        appendPart(cardId, {
          id: `error-${Date.now()}`,
          kind: 'error',
          placement: 'inline',
          timestamp: Date.now(),
          data: { message: `Error: ${err}` },
        });
        markQueryComplete(cardId);
        await cardsStore.updateCardState(cardId, 'idle');
      }
    } else {
      // No sidecar running — spawn a new one
      setupMessageListener(cardId);
      try {
        await spawnSession(cardId, project.path, message, sessionId, config, images, flowPayload, forkSession);
      } catch (err) {
        appendPart(cardId, {
          id: `error-${Date.now()}`,
          kind: 'error',
          placement: 'inline',
          timestamp: Date.now(),
          data: { message: `Error: ${err}` },
        });
        markQueryComplete(cardId);
        await cardsStore.updateCardState(cardId, 'idle');
        offMessage(cardId);
        offMeta(cardId);
      }
    }
  }

  async function approveToolUse(cardId: string, updatedInput?: Record<string, unknown>): Promise<void> {
    cardAttentionState.delete(cardId); // HOME: Clear attention on approval
    await sendReply(cardId, 'allow', updatedInput);
  }

  async function rejectToolUse(cardId: string): Promise<void> {
    cardAttentionState.delete(cardId); // HOME: Clear attention on rejection
    await sendReply(cardId, 'deny');
  }

  async function interruptSession(cardId: string): Promise<void> {
    await interrupt(cardId);
  }

  async function stopSession(cardId: string): Promise<void> {
    offMessage(cardId);
    offMeta(cardId);
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
    const projectId = useProjectsStore().activeProjectId;
    if (projectId) {
      activeChatCardByProject.set(projectId, cardId);
      // NAV: Register card-project association for cross-project activity indicators
      cardProjectMap.set(cardId, projectId);
    }

    // HOME: Update lastViewedAt so Activity panel can track "unseen changes"
    import('~/services/database').then(db => db.updateCardLastViewedAt(cardId));
    const cardsStore = useCardsStore();
    const cardForViewed = cardsStore.cards.find(c => c.id === cardId);
    if (cardForViewed) cardForViewed.lastViewedAt = new Date().toISOString();

    // Seed session metrics from persisted card data (survives app restart)
    const card = cardsStore.cards.find(c => c.id === cardId);
    if (card && !sessionMetrics[cardId]) {
      sessionMetrics[cardId] = {
        costUsd: card.costUsd || 0,
        inputTokens: card.inputTokens || 0,
        outputTokens: card.outputTokens || 0,
        durationMs: card.durationMs || 0,
      };
    }

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
        _loadingHistory.value.add(cardId);
        triggerRef(_loadingHistory);
        loadHistoryViaSidecar(card.sessionId).then((history) => {
          if (import.meta.dev) console.log('[OnCraft] loaded', history.length, 'messages from history');
          if (history.length > 0) {
            messages[cardId] = history;
          }
        }).finally(() => {
          _loadingHistory.value.delete(cardId);
          triggerRef(_loadingHistory);
        });
      }
    }
  }
  function closeChat(): void {
    const projectId = useProjectsStore().activeProjectId;
    if (projectId) activeChatCardByProject.delete(projectId);
  }
  function isActive(cardId: string): boolean { return isQueryActive(cardId); }
  function isLoadingHistory(cardId: string): boolean { return _loadingHistory.value.has(cardId); }

  // Fire the trigger prompt when a card moves to a new FlowState
  // Called by KanbanColumn.onDragEnd after a successful card move.
  async function fireTriggerPrompt(cardId: string, fromSlug: string, toSlug: string): Promise<void> {
    const flowStore  = useFlowStore();
    const raw        = flowStore.getTriggerPrompt(toSlug);
    if (!raw) return;

    const cardsStore = useCardsStore();
    const card       = cardsStore.cards.find(c => c.id === cardId);
    const project    = useProjectsStore().activeProject;
    if (!card || !project) return;

    const linkedFiles = card.linkedFiles || {};
    const prompt = resolveTemplate(raw, {
      session: { name: card.name, id: card.sessionId || '' },
      project: { path: project.path, name: project.name },
      card:    { description: card.description, linkedFiles, linkedIssues: card.linkedIssues },
      column:  { from: fromSlug, to: toSlug },
    });

    await send(cardId, prompt);
  }

  // ME-3: Purge in-memory messages for a card (e.g. when archived or removed)
  function purgeCard(cardId: string): void {
    delete messages[cardId];
    delete sessionConfigs[cardId];
    delete sessionMetrics[cardId];
    delete activeSubAgents[cardId];
    delete queryTracking[cardId];
    historyLoaded.delete(cardId);
    _streamingBuffers.delete(cardId);
    _streamingRafPending.delete(cardId);
    _streamingTokenCount.delete(cardId);
    _thinkingBuffers.delete(cardId);
    _thinkingRafPending.delete(cardId);
    activeToolByCard.delete(cardId);
    cardAttentionState.delete(cardId);
    // NAV: Clean up per-project active chat if this card was open
    const pid = cardProjectMap.get(cardId);
    if (pid && activeChatCardByProject.get(pid) === cardId) {
      activeChatCardByProject.delete(pid);
    }
    cardProjectMap.delete(cardId);
  }

  async function shutdownAllSessions(): Promise<void> {
    const cardIds = new Set<string>([
      ...Object.keys(messages),
      ...Object.keys(sessionConfigs),
      ...Object.keys(sessionMetrics),
      ...Object.keys(activeSubAgents),
      ...Object.keys(queryTracking),
      ...listActiveProcessCardIds(),
    ]);

    for (const cardId of cardIds) {
      try { await stopSession(cardId); } catch { /* continue cleanup */ }
      purgeCard(cardId);
    }

    try { await killAllProcesses(); } catch { /* no-op */ }
    shutdownUtilSidecar();
  }

  return {
    messages, activeChatCardId, sessionConfigs, sessionMetrics, availableCommands, activeSubAgents, activeToolByCard, cardAttentionState,
    getMessages, getSessionConfig, updateSessionConfig, getSessionMetrics, getActiveSubAgentCount, getQueryTracking,
    appendPart, resolveActionPart, handleMeta, fireTriggerPrompt,
    send, approveToolUse, rejectToolUse,
    loadAvailableCommands, interruptSession, stopSession, openChat, closeChat, isActive, isLoadingHistory, purgeCard,
    shutdownAllSessions,
    hasActiveCards,
  };
});
