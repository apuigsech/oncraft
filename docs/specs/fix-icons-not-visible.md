# Fix: Some Icons Are Not Visible

## Problem Statement

Several icons throughout the OnCraft UI are invisible or not rendering. The root causes are:

1. **Missing `@iconify-json/simple-icons` dependency**: Icons from the `simple-icons` collection (`i-simple-icons-anthropic`, `i-simple-icons-github`) are referenced in source code but the package is not installed. These icons depend on runtime fetching from the Iconify CDN API, which fails in Tauri's desktop context or offline.

2. **Dynamic icon references not detected by bundle scanner**: `nuxt.config.ts` uses `clientBundle.scan: true` which statically scans `.vue`/`.ts` files at build time. Icons resolved dynamically (via `appConfig.ui.icons.*` inside compiled Nuxt UI components in `node_modules`) are not detected by the scanner and may not be included in the client bundle.

3. **Scroll-to-bottom button mispositioned**: The `UChatMessages` component from Nuxt UI renders an auto-scroll button (using `appConfig.ui.icons.arrowDown` = `i-lucide-arrow-down`). This button appears centered relative to the full window instead of centered within the chat panel, making it overlap the Kanban columns. The icon itself may also be invisible due to cause #2.

## Affected Icons

### Not rendering (confirmed)

| Icon | Location | Cause |
|------|----------|-------|
| `i-simple-icons-anthropic` | `InputToolbar` model selector (Opus/Sonnet/Haiku) | `@iconify-json/simple-icons` not installed |
| `i-simple-icons-github` | `ProjectInfoBar` header | `@iconify-json/simple-icons` not installed |
| `i-lucide-arrow-down` | `UChatMessages` scroll-to-bottom button | Dynamic ref via `appConfig.ui.icons.arrowDown`, possibly not scanned |
| `i-lucide-zap` | `InputToolbar` YOLO permission mode | Referenced in `constants/options.ts`, resolved dynamically via `computed()` |

### At risk (dynamic references from Nuxt UI internals)

These icons are used internally by Nuxt UI components via `appConfig.ui.icons.*` and may not be detected by the scanner:

| Icon | Nuxt UI usage |
|------|---------------|
| `i-lucide-arrow-up` | `UChatPromptSubmit` send button (ready state) |
| `i-lucide-square` | `UChatPromptSubmit` stop button (streaming state) |
| `i-lucide-rotate-ccw` | `UChatPromptSubmit` reload button (error state) |
| `i-lucide-loader-circle` | Nuxt UI loading spinner |
| `i-lucide-check` | Nuxt UI checkboxes, selects |
| `i-lucide-chevron-down` | Nuxt UI selects, trees |
| `i-lucide-x` | Nuxt UI close buttons, modals |
| `i-lucide-chevron-left` | Nuxt UI navigation |
| `i-lucide-chevron-right` | Nuxt UI navigation, breadcrumbs |

Note: some of these may already be scanned because they also appear as static strings in OnCraft source files (e.g. `i-lucide-x` is used directly in multiple components). The fix should be defensive and include all of them regardless.

## Requirements

### R1: Install missing icon collection

Install `@iconify-json/simple-icons` as a devDependency so `i-simple-icons-anthropic` and `i-simple-icons-github` are available in the client bundle.

**Acceptance criteria:**
- `@iconify-json/simple-icons` is listed in `package.json` devDependencies
- The Anthropic logo renders in the model selector dropdown
- The GitHub logo renders in the project info bar

### R2: Explicit icon include list in nuxt.config.ts

Add an explicit `include` list to the `icon.clientBundle` config in `nuxt.config.ts` that covers all dynamically-referenced icons. This ensures they are bundled regardless of whether the scanner detects them.

**Acceptance criteria:**
- `nuxt.config.ts` `icon.clientBundle` contains an `include` array
- The include list covers all Nuxt UI internal icons (`appConfig.ui.icons.*`)
- The include list covers all `simple-icons` used in the app
- The include list covers all icons from preset YAML files that are loaded at runtime
- `scan: true` remains enabled so statically-referenced icons continue to work automatically
- All previously invisible icons now render correctly

### R3: Fix scroll-to-bottom button positioning

Override the CSS of the `UChatMessages` auto-scroll button (`viewport` slot) so it positions relative to the chat panel container instead of the full window.

**Acceptance criteria:**
- The scroll-to-bottom button appears centered horizontally within the chat panel
- The button does not overlap Kanban columns or other UI elements outside the chat
- The button appears when scrolling up in the chat and disappears when at the bottom
- The button icon (`i-lucide-arrow-down`) is visible

## Constraints

- **No icon collection changes**: Keep using Lucide as the primary collection and Simple Icons for brand logos. Do not switch to a different icon system.
- **Keep `scan: true`**: The automatic scanning is useful for the majority of icons. The `include` list is supplementary, not a replacement.
- **No Nuxt UI version changes**: Fix within the current `@nuxt/ui ^4.6.0`.
- **Minimal CSS overrides**: Use `ui` prop or scoped styles for the scroll button fix. Avoid global CSS that could affect other components.

## Out of Scope

- Auditing or changing which icons are used for specific features (e.g., replacing the Anthropic logo with something else)
- Adding new icons for features that don't currently have them
- Changing the scroll-to-bottom behavior (auto-scroll logic, threshold, animation) -- only fixing its position and visibility
- Supporting user-defined custom icon collections in `.oncraft/` flow configs (this is a separate feature)
