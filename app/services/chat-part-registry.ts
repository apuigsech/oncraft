import type { SidecarMessage, ChatPart, ChatPartDefinition } from '~/types';

const registry: Record<string, ChatPartDefinition> = {
  // ── Conversation Messages ──────────────────────────────────────────
  assistant: {
    placement: 'inline',
    component: 'MarkdownContent',
    verbosity: 'quiet',
    parse: (raw) => ({
      content: raw.content ?? '',
      ...(raw.usage ? { usage: { inputTokens: (raw.usage as any).inputTokens, outputTokens: (raw.usage as any).outputTokens } } : {}),
      ...(raw.subtype === 'thinking' ? { thinking: true } : {}),
      ...(raw.streaming ? { streaming: true } : {}),
      ...(raw.parentToolUseId != null ? { parentToolUseId: raw.parentToolUseId } : {}),
    }),
  },

  user: {
    placement: 'inline',
    component: 'UserMessageBlock',
    verbosity: 'quiet',
    parse: (raw) => ({
      content: raw.content ?? '',
      ...(raw.images ? { images: raw.images } : {}),
      ...(raw.isSynthetic ? { isSynthetic: true } : {}),
      ...(raw.parentToolUseId != null ? { parentToolUseId: raw.parentToolUseId } : {}),
    }),
  },

  tool_use: {
    placement: 'inline',
    component: 'ToolCallBlock',
    verbosity: 'quiet',
    parse: (raw) => ({
      toolName: raw.toolName ?? '',
      toolInput: raw.toolInput ?? {},
      toolUseId: raw.toolUseId ?? '',
      ...(raw.toolResult !== undefined ? { toolResult: raw.toolResult } : {}),
      ...(raw.parentToolUseId != null ? { parentToolUseId: raw.parentToolUseId } : {}),
    }),
  },

  tool_confirmation: {
    placement: 'action-bar',
    component: 'ToolApprovalBar',
    verbosity: 'quiet',
    parse: (raw) => ({
      toolName: raw.toolName ?? '',
      toolInput: raw.toolInput ?? {},
      toolUseId: raw.toolUseId ?? '',
      ...(raw.title ? { title: raw.title } : {}),
      ...(raw.displayName ? { displayName: raw.displayName } : {}),
      ...(raw.description ? { description: raw.description } : {}),
    }),
  },

  tool_result: {
    placement: 'hidden',
    component: null,
    verbosity: 'quiet',
    parse: (raw) => ({
      toolUseId: raw.toolUseId ?? '',
      content: raw.content ?? '',
      ...(raw.parentToolUseId != null ? { parentToolUseId: raw.parentToolUseId } : {}),
    }),
  },

  error: {
    placement: 'inline',
    component: 'ErrorNotice',
    verbosity: 'quiet',
    parse: (raw) => ({
      message: raw.message ?? raw.content ?? '',
      ...(raw.retryAfter !== undefined ? { retryAfter: raw.retryAfter } : {}),
    }),
  },

  // ── Tool Overrides ─────────────────────────────────────────────────
  // Skill tool_use is hidden — the synthetic user message becomes the SyntheticBadge
  'tool_use:Skill': {
    placement: 'hidden',
    component: null,
    verbosity: 'quiet',
    parse: (raw) => ({
      toolUseId: raw.toolUseId ?? '',
      skillName: (raw.toolInput as Record<string, unknown>)?.skill ?? '',
    }),
  },

  // Agent tool_use renders as a collapsible subagent block
  'tool_use:Agent': {
    placement: 'inline',
    component: 'SubagentBlock',
    verbosity: 'quiet',
    parse: (raw) => ({
      toolName: raw.toolName ?? 'Agent',
      toolInput: raw.toolInput ?? {},
      toolUseId: raw.toolUseId ?? '',
      description: (raw.toolInput as Record<string, unknown>)?.description ?? '',
      parentToolUseId: raw.parentToolUseId ?? null,
      ...(raw.toolResult !== undefined ? { toolResult: raw.toolResult } : {}),
    }),
  },

  // Synthetic user messages (skill prompts, system-reminders) render as SyntheticBadge
  'user:synthetic': {
    placement: 'inline',
    component: 'SyntheticBadge',
    verbosity: 'quiet',
    parse: (raw) => ({
      content: raw.content ?? '',
      isSynthetic: true,
    }),
  },

  // tool_use of AskUserQuestion is hidden — the tool_confirmation is what we show
  'tool_use:AskUserQuestion': {
    placement: 'hidden',
    component: null,
    verbosity: 'quiet',
    parse: (raw) => ({ toolUseId: raw.toolUseId ?? '' }),
  },

  // tool_confirmation of AskUserQuestion shows the interactive question widget
  'tool_confirmation:AskUserQuestion': {
    placement: 'action-bar',
    component: 'UserQuestionBar',
    verbosity: 'quiet',
    parse: (raw) => {
      const toolInput = (raw.toolInput ?? {}) as Record<string, unknown>;
      const questions = (toolInput.questions ?? []) as Array<{
        question: string;
        header?: string;
        options?: Array<{ label: string; description?: string }>;
        multiSelect?: boolean;
      }>;
      return {
        questions,
        toolName: raw.toolName ?? 'AskUserQuestion',
        toolInput: raw.toolInput ?? {},
        toolUseId: raw.toolUseId ?? '',
      };
    },
  },

  'tool:TodoWrite': {
    placement: 'header',
    component: 'TaskListDisplay',
    verbosity: 'quiet',
    parse: (raw) => {
      const toolInput = (raw.toolInput ?? {}) as Record<string, unknown>;
      return {
        todos: toolInput.todos ?? [],
      };
    },
  },

  // ── Hooks ──────────────────────────────────────────────────────────
  hook_started: {
    placement: 'inline',
    component: 'HookActivityBlock',
    verbosity: 'verbose',
    parse: (raw) => ({
      hookId: raw.hookId ?? '',
      hookName: raw.hookName ?? '',
      hookEvent: raw.hookEvent ?? '',
    }),
  },

  hook_progress: {
    placement: 'inline',
    component: 'HookActivityBlock',
    verbosity: 'verbose',
    parse: (raw) => ({
      hookId: raw.hookId ?? '',
      hookName: raw.hookName ?? '',
      hookEvent: raw.hookEvent ?? '',
      stdout: raw.stdout ?? '',
      stderr: raw.stderr ?? '',
      output: raw.output ?? '',
    }),
  },

  hook_response: {
    placement: 'inline',
    component: 'HookActivityBlock',
    verbosity: 'verbose',
    parse: (raw) => ({
      hookId: raw.hookId ?? '',
      hookName: raw.hookName ?? '',
      hookEvent: raw.hookEvent ?? '',
      output: raw.output ?? '',
      ...(raw.exitCode !== undefined ? { exitCode: raw.exitCode } : {}),
      outcome: raw.outcome ?? '',
    }),
  },

  // ── Progress and Status ────────────────────────────────────────────
  task_started: {
    placement: 'progress',
    component: null,
    verbosity: 'quiet',
    parse: (raw) => ({
      taskId: raw.taskId ?? '',
      description: raw.description ?? raw.content ?? '',
      ...(raw.taskType ? { taskType: raw.taskType } : {}),
    }),
  },

  task_progress: {
    placement: 'progress',
    component: null,
    verbosity: 'quiet',
    parse: (raw) => ({
      taskId: raw.taskId ?? '',
      description: raw.description ?? raw.content ?? '',
      ...(raw.lastToolName ? { lastToolName: raw.lastToolName } : {}),
      ...(raw.summary ? { summary: raw.summary } : {}),
    }),
  },

  task_notification: {
    placement: 'progress',
    component: null,
    verbosity: 'quiet',
    parse: (raw) => ({
      taskId: raw.taskId ?? '',
      content: raw.content ?? '',
    }),
  },

  status: {
    placement: 'progress',
    component: null,
    verbosity: 'quiet',
    parse: (raw) => ({
      status: raw.status ?? raw.content ?? '',
      ...(raw.permissionMode ? { permissionMode: raw.permissionMode } : {}),
    }),
  },

  tool_progress: {
    placement: 'progress',
    component: null,
    verbosity: 'quiet',
    parse: (raw) => ({
      toolUseId: raw.toolUseId ?? '',
      toolName: raw.toolName ?? '',
      elapsedSeconds: raw.elapsedSeconds ?? 0,
      ...(raw.parentToolUseId != null ? { parentToolUseId: raw.parentToolUseId } : {}),
    }),
  },

  // ── Informational ──────────────────────────────────────────────────
  local_command_output: {
    placement: 'inline',
    component: null,
    verbosity: 'normal',
    parse: (raw) => ({
      content: raw.content ?? '',
    }),
  },

  prompt_suggestion: {
    placement: 'action-bar',
    component: 'PromptSuggestionBar',
    verbosity: 'normal',
    parse: (raw) => ({
      suggestion: raw.suggestion ?? raw.content ?? '',
    }),
  },

  rate_limit_event: {
    placement: 'inline',
    component: 'RateLimitNotice',
    verbosity: 'normal',
    parse: (raw) => ({
      rateLimitInfo: raw.rateLimitInfo ?? {},
    }),
  },

  api_retry: {
    placement: 'inline',
    component: 'RateLimitNotice',
    verbosity: 'quiet',
    parse: (raw) => ({
      isRetry: true,
      attempt: raw.attempt,
      maxRetries: raw.maxRetries,
      retryDelayMs: raw.retryDelayMs,
      errorStatus: raw.errorStatus,
    }),
  },

  auth_status: {
    placement: 'inline',
    component: null,
    verbosity: 'normal',
    parse: (raw) => ({
      isAuthenticating: raw.isAuthenticating ?? false,
      output: raw.output ?? [],
      ...(raw.error ? { error: raw.error } : {}),
    }),
  },

  tool_use_summary: {
    placement: 'inline',
    component: null,
    verbosity: 'normal',
    parse: (raw) => ({
      summary: raw.summary ?? raw.content ?? '',
      precedingToolUseIds: raw.precedingToolUseIds ?? [],
    }),
  },

  compact_boundary: {
    placement: 'inline',
    component: null,
    verbosity: 'verbose',
    parse: (raw) => {
      const meta = (raw.compactMetadata ?? {}) as Record<string, unknown>;
      return {
        trigger: meta.trigger ?? '',
        preTokens: meta.preTokens ?? 0,
      };
    },
  },

  files_persisted: {
    placement: 'inline',
    component: null,
    verbosity: 'verbose',
    parse: (raw) => ({
      files: raw.files ?? [],
      failed: raw.failed ?? [],
    }),
  },

  elicitation_complete: {
    placement: 'inline',
    component: null,
    verbosity: 'verbose',
    parse: (raw) => ({
      mcpServerName: raw.mcpServerName ?? '',
      elicitationId: raw.elicitationId ?? '',
    }),
  },

  // ── Internal ───────────────────────────────────────────────────────
  result: {
    placement: 'hidden',
    component: null,
    verbosity: 'quiet',
    parse: (raw) => ({
      sessionId: raw.sessionId ?? '',
      ...(raw.costUsd !== undefined ? { costUsd: raw.costUsd } : {}),
      ...(raw.durationMs !== undefined ? { durationMs: raw.durationMs } : {}),
      ...(raw.usage ? { usage: { inputTokens: (raw.usage as any).inputTokens, outputTokens: (raw.usage as any).outputTokens } } : {}),
    }),
  },

  init: {
    placement: 'hidden',
    component: null,
    verbosity: 'quiet',
    parse: (raw) => ({
      sessionId: raw.sessionId ?? '',
      ...(raw.gitBranch ? { gitBranch: raw.gitBranch } : {}),
      ...(raw.model ? { model: raw.model } : {}),
      ...(raw.worktreePath ? { worktreePath: raw.worktreePath } : {}),
      ...(raw.worktreeBranch ? { worktreeBranch: raw.worktreeBranch } : {}),
    }),
  },

  // ── Fallback ───────────────────────────────────────────────────────
  _default: {
    placement: 'inline',
    component: 'GenericMessageBlock',
    verbosity: 'verbose',
    parse: (raw) => ({ ...raw }),
  },
};

/**
 * Resolve a sidecar message to its ChatPartDefinition.
 * Two-level resolution: tool overrides first, then message type, then fallback.
 */
function resolve(msg: SidecarMessage): ChatPartDefinition {
  if ((msg.type === 'tool_use' || msg.type === 'tool_confirmation') && msg.toolName) {
    // First try type-specific override (e.g. tool_confirmation:AskUserQuestion)
    const typeSpecific = registry[`${msg.type}:${msg.toolName}`];
    if (typeSpecific) return typeSpecific;
    // Then try generic tool override (e.g. tool:TodoWrite)
    const generic = registry[`tool:${msg.toolName}`];
    if (generic) return generic;
  }
  return registry[msg.type] || registry['_default']!;
}

/**
 * Determine the kind string for a sidecar message.
 * Returns the tool override key if matched, otherwise the message type.
 */
function resolveKind(msg: SidecarMessage): string {
  if ((msg.type === 'tool_use' || msg.type === 'tool_confirmation') && msg.toolName) {
    const typeSpecific = `${msg.type}:${msg.toolName}`;
    if (registry[typeSpecific]) return typeSpecific;
    const generic = `tool:${msg.toolName}`;
    if (registry[generic]) return generic;
  }
  return msg.type;
}

let _idCounter = 0;

/**
 * Process a sidecar message into a ChatPart.
 * Returns null for hidden placements (tool_result, result, init).
 */
function process(msg: SidecarMessage): ChatPart | null {
  const definition = resolve(msg);
  if (definition.placement === 'hidden') return null;
  const kind = resolveKind(msg);
  const data = definition.parse(msg as Record<string, unknown>);
  return {
    id: `${msg.type}-${_idCounter++}`,
    kind,
    placement: definition.placement,
    timestamp: Date.now(),
    data,
    raw: msg as Record<string, unknown>,
  };
}

/**
 * Reset the internal ID counter. Useful for tests.
 */
function resetIdCounter(): void {
  _idCounter = 0;
}

export { registry, resolve, process, resetIdCounter };
