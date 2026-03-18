export interface SidecarMessage {
  type: string;
  [key: string]: unknown;
}

export type Placement = 'header' | 'inline' | 'action-bar' | 'progress' | 'hidden';
export type VerbosityLevel = 'quiet' | 'normal' | 'verbose';

export interface ChatPart {
  id: string;
  kind: string;
  placement: Placement;
  timestamp: number;
  data: Record<string, unknown>;
  raw?: Record<string, unknown>;
  resolved?: boolean;
}

export interface ChatPartDefinition {
  parse: (raw: Record<string, unknown>) => Record<string, unknown>;
  placement: Placement;
  component: string | null;
  verbosity: VerbosityLevel;
}
