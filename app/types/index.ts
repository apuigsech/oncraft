export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  lastOpenedAt: string;
}

export interface Card {
  id: string;
  projectId: string;
  name: string;
  description: string;
  columnName: string;
  columnOrder: number;
  sessionId: string;
  consoleSessionId?: string;
  state: CardState;
  tags: string[];
  createdAt: string;
  lastActivityAt: string;
  archived: boolean;
  useWorktree?: boolean;
  worktreeName?: string;
}

export type CardState = 'active' | 'idle' | 'error' | 'completed';

export interface ColumnConfig {
  name: string;
  color: string;
}

export interface PipelineConfig {
  from: string;
  to: string;
  prompt: string;
}

export interface ProjectConfig {
  columns: ColumnConfig[];
  pipelines: PipelineConfig[];
}

export type ChatMode = 'integrated' | 'console';

export interface GlobalSettings {
  theme: 'dark' | 'light';
  defaultColumns: ColumnConfig[];
  chatMode: ChatMode;
}

export interface StreamMessage {
  type: 'assistant' | 'user' | 'tool_use' | 'tool_result' | 'system' | 'tool_confirmation';
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
  toolUseId?: string;
  subtype?: string;
  sessionId?: string;
  timestamp: number;
  usage?: { inputTokens: number; outputTokens: number };
  costUsd?: number;
  durationMs?: number;
  retryAfter?: number;
  gitBranch?: string;
  worktreePath?: string;
  worktreeBranch?: string;
}

// Internal SDK progress events — not stored in the message list, tracked separately
export interface AgentProgressEvent {
  subtype: 'task_started' | 'task_progress' | 'task_notification' | 'status' | string;
  content: string;
  timestamp: number;
  raw?: Record<string, unknown>;
}

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
export type EffortLevel = 'low' | 'medium' | 'high' | 'max';
export type ModelAlias = 'opus' | 'sonnet' | 'haiku';

export interface SessionConfig {
  model: ModelAlias;
  effort: EffortLevel;
  permissionMode: PermissionMode;
  gitBranch?: string;
  worktreeName?: string;
  worktreePath?: string;
  worktreeBranch?: string;
}

export interface TemplateContext {
  session: { name: string; id: string };
  project: { path: string; name: string };
  card: { description: string };
  column: { from: string; to: string };
}
