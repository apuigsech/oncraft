/**
 * Central theme definition for ClaudBan.
 * Change values here to affect the entire UI consistently.
 *
 * These constants are used:
 *  - In `src/assets/theme.css`  → Tailwind v4 @theme tokens (consumed by Nuxt UI)
 *  - Directly in components     → when a dynamic value is needed (e.g. column colors)
 */

// ---------------------------------------------------------------------------
// Brand / semantic colors  (maps to Nuxt UI `color` prop values)
// ---------------------------------------------------------------------------
export const colors = {
  /** Primary action color (UButton color="primary", focus rings, etc.) */
  primary: 'blue',
  /** Success / active state */
  success: 'green',
  /** Warning state */
  warning: 'amber',
  /** Destructive / error state */
  error: 'red',
  /** Neutral surface color */
  neutral: 'slate',
} as const;

export type AppColor = (typeof colors)[keyof typeof colors];

// ---------------------------------------------------------------------------
// Card state → Nuxt UI color mapping
// ---------------------------------------------------------------------------
export const cardStateColor: Record<string, AppColor> = {
  active: colors.success,
  idle: colors.neutral,
  error: colors.error,
  completed: colors.neutral,
};

// ---------------------------------------------------------------------------
// Permission mode → color mapping (used in InputToolbar)
// ---------------------------------------------------------------------------
export const permissionModeColor: Record<string, AppColor> = {
  default: colors.neutral,
  acceptEdits: colors.success,
  plan: colors.warning,
  bypassPermissions: colors.error,
};

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------
export const layout = {
  chatPanelDefaultWidth: 400,
  chatPanelMinWidth: 320,
  chatPanelMaxWidth: 600,
  kanbanColumnMinWidth: 260,
  kanbanColumnMaxWidth: 300,
} as const;
