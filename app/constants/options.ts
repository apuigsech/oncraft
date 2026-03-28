import type { ChatMode, ModelAlias, EffortLevel, PermissionMode } from '~/types';

export const CHAT_MODE_OPTIONS = [
  { label: 'Integrated UI', value: 'integrated' as ChatMode, description: 'Rich chat with markdown, tool blocks, and metrics', icon: 'i-lucide-message-square' },
  { label: 'Console (Terminal)', value: 'console' as ChatMode, description: 'Full Claude CLI running in an embedded terminal', icon: 'i-lucide-terminal' },
];

export const MODEL_OPTIONS = [
  { label: 'Opus',   value: 'opus' as ModelAlias,   icon: 'i-simple-icons-anthropic' },
  { label: 'Sonnet', value: 'sonnet' as ModelAlias, icon: 'i-simple-icons-anthropic' },
  { label: 'Haiku',  value: 'haiku' as ModelAlias,  icon: 'i-simple-icons-anthropic' },
];

export const EFFORT_LEVELS: EffortLevel[] = ['low', 'medium', 'high', 'max'];

export const EFFORT_LABELS: Record<EffortLevel, string> = {
  low: 'Lo',
  medium: 'Med',
  high: 'Hi',
  max: 'Max',
};

export const MODE_OPTIONS = [
  { label: 'Default',   value: 'default' as PermissionMode,           icon: 'i-lucide-lock' },
  { label: 'Auto-edit', value: 'acceptEdits' as PermissionMode,       icon: 'i-lucide-pencil',         class: 'text-primary', ui: { itemLeadingIcon: 'text-primary' } },
  { label: 'Plan',      value: 'plan' as PermissionMode,              icon: 'i-lucide-clipboard-list', class: 'text-warning', ui: { itemLeadingIcon: 'text-warning' } },
  { label: 'YOLO',      value: 'bypassPermissions' as PermissionMode, icon: 'i-lucide-zap',            class: 'text-error',   ui: { itemLeadingIcon: 'text-error' } },
];
