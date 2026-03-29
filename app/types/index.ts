import type { VerbosityLevel } from './chat-part';
export type { SidecarMessage, ChatPart, ChatPartDefinition, Placement, VerbosityLevel } from './chat-part';

export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  lastOpenedAt: string;
  closed?: boolean;
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
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  linkedFiles?: Record<string, string>;    // { label: relativePath } e.g. { "plan": "docs/plan.md" }
  linkedIssues?: CardLinkedIssue[];
  forkedFromId?: string;
  lastViewedAt?: string;
}

export type CardState = 'active' | 'idle' | 'error' | 'completed';

export interface ColumnConfig {
  name: string;
  color: string;
  icon?: string;
  inputs?: string[];
  outputs?: string[];
  prompt?: string;
}

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface AgentConfig {
  model?: ModelAlias;
  effort?: EffortLevel;
  permissionMode?: PermissionMode;
  verbosity?: VerbosityLevel;
}

export interface FlowState {
  slug: string;           // directory name — maps to Card.columnName
  name: string;           // display name
  color: string;
  icon?: string;          // Iconify name e.g. "heroicons:magnifying-glass"
  agent?: Partial<AgentConfig>;
  agents?: string[];      // agent names → resolved at runtime
  skills?: string[];
  mcpServers?: Record<string, McpServerConfig>;
  tools?: {
    allowed?: string[];
    disallowed?: string[];
  };
  requiredFiles?: string[];
  prompt?: string;        // loaded from prompt.md
  triggerPrompt?: string; // loaded from trigger.md
}

export interface Flow {
  name: string;
  preset?: string;
  agent: AgentConfig;
  agents: string[];
  skills: string[];
  mcpServers: Record<string, McpServerConfig>;
  tools: {
    allowed: string[];
    disallowed: string[];
  };
  stateOrder: string[];
  states: FlowState[];    // populated from filesystem
}

export interface FlowWarning {
  scope: 'flow' | 'state';
  stateSlug?: string;
  message: string;
}

export interface CardLinkedIssue {
  number: number;
  title?: string;       // cached title for display without fetching
}

export interface GitHubConfig {
  repository?: string;   // "owner/repo"
}

export interface GitHubIssue {
  number: number;
  title: string;
  body?: string;
  labels: string[];
  state: string;
}

export interface ProjectConfig {
  columns: ColumnConfig[];
  github?: GitHubConfig;
}

export interface ImageAttachment {
  id: string;
  data: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  name: string;
  size: number;
}

export type ChatMode = 'integrated' | 'console';

export interface GlobalSettings {
  theme: 'dark'; // TODO: light theme not yet implemented
  chatMode: ChatMode;
  defaultModel?: ModelAlias;
  defaultEffort?: EffortLevel;
  defaultPermissionMode?: PermissionMode;
  onboardingCompleted?: boolean;
  onboardingDismissed?: boolean;
  telemetryEnabled?: boolean;
  telemetryInstallId?: string;
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
  images?: ImageAttachment[];
  retryAfter?: number;
  gitBranch?: string;
  worktreePath?: string;
  worktreeBranch?: string;
}

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
export type EffortLevel = 'low' | 'medium' | 'high' | 'max';
export type ModelAlias = 'opus' | 'sonnet' | 'haiku';

export interface SessionConfig {
  model: ModelAlias;
  effort: EffortLevel;
  permissionMode: PermissionMode;
  verbosity: VerbosityLevel;
  gitBranch?: string;
  worktreeName?: string;
  worktreePath?: string;
  worktreeBranch?: string;
}

export type ActivityPriority = 'attention' | 'active' | 'unseen' | 'inactive';

export interface ActivityCardRow {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  columnName: string;
  lastActivityAt: string;
  lastViewedAt: string | null;
  state: string;
  priority: ActivityPriority;
  toolName?: string;
  toolContext?: string;
}

export interface DailyCost {
  date: string;
  cost: number;
}

export interface TemplateContext {
  session: { name: string; id: string };
  project: { path: string; name: string };
  card: { description: string; linkedFiles: Record<string, string>; linkedIssues?: CardLinkedIssue[] };
  column: { from: string; to: string };
}
