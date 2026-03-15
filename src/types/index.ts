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
  state: CardState;
  tags: string[];
  createdAt: string;
  lastActivityAt: string;
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

export interface GlobalSettings {
  theme: 'dark' | 'light';
  defaultColumns: ColumnConfig[];
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
}

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
export type EffortLevel = 'low' | 'medium' | 'high' | 'max';
export type ModelAlias = 'opus' | 'sonnet' | 'haiku';

export interface SessionConfig {
  model: ModelAlias;
  effort: EffortLevel;
  permissionMode: PermissionMode;
  gitBranch?: string;
}

export interface TemplateContext {
  session: { name: string; id: string };
  project: { path: string; name: string };
  card: { description: string };
  column: { from: string; to: string };
}
