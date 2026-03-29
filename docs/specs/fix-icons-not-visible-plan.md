# Plan: Fix Icons Not Visible

Spec: `docs/specs/fix-icons-not-visible.md`

## Step 1: Install `@iconify-json/simple-icons`

**Requirement**: R1

Add the missing icon collection so `i-simple-icons-anthropic` and `i-simple-icons-github` resolve locally instead of depending on CDN fetching.

**Actions:**
- Run `pnpm add -D @iconify-json/simple-icons`

**Files modified:**
- `package.json` (devDependencies)
- `pnpm-lock.yaml` (auto-generated)

**Dependencies:** None (first step).

---

## Step 2: Add explicit `include` list to icon client bundle config

**Requirement**: R2

Add an `include` array to `nuxt.config.ts` `icon.clientBundle` that force-bundles all dynamically-referenced icons. These fall into three categories:

**Category A — Nuxt UI internal icons** (from `appConfig.ui.icons.*`, not in scanned source):
```
i-lucide-arrow-down
i-lucide-arrow-left
i-lucide-arrow-right
i-lucide-arrow-up
i-lucide-arrow-up-right
i-lucide-check
i-lucide-chevrons-left
i-lucide-chevrons-right
i-lucide-circle-alert
i-lucide-circle-check
i-lucide-circle-x
i-lucide-copy
i-lucide-copy-check
i-lucide-grip-vertical
i-lucide-hash
i-lucide-info
i-lucide-loader-circle
i-lucide-menu
i-lucide-minus
i-lucide-monitor
i-lucide-moon
i-lucide-panel-left-close
i-lucide-panel-left-open
i-lucide-rotate-ccw
i-lucide-sun
i-lucide-triangle-alert
i-lucide-upload
```

**Category B — Preset YAML icons** (loaded at runtime from `presets/swe-basic/states/*/state.yaml`):
```
i-lucide-lightbulb
i-lucide-code
i-lucide-search-check
```
Note: `i-lucide-file-text`, `i-lucide-list-checks`, `i-lucide-circle-check` are already covered by source scan or Category A.

**Category C — Simple Icons** (brand logos):
```
i-simple-icons-anthropic
i-simple-icons-github
```

Many Category A icons overlap with icons already used statically in source code (e.g. `i-lucide-chevron-down`, `i-lucide-x`, `i-lucide-plus`, `i-lucide-search`, `i-lucide-square`, `i-lucide-eye`, `i-lucide-eye-off`, `i-lucide-ellipsis`, `i-lucide-folder`, `i-lucide-folder-open`). Including them in the explicit list is harmless (deduplicated by the bundler) and defensive.

**Actions:**
- Edit `nuxt.config.ts`: add `include` array to `icon.clientBundle`, keep `scan: true`

**Files modified:**
- `nuxt.config.ts`

**Dependencies:** Step 1 (simple-icons must be installed for Category C to resolve).

---

## Step 3: Fix scroll-to-bottom button positioning

**Requirement**: R3

The `UChatMessages` component renders the auto-scroll button inside a `viewport` slot with CSS that positions it relative to the scroll parent (which resolves to the window/body). The fix is to:

1. Ensure `.chat-messages-wrapper` (the scroll container in `ChatPanel.vue`) has `position: relative` so it becomes the positioning context.
2. Override the `UChatMessages` viewport slot CSS via the `ui` prop or scoped `:deep()` styles to use `position: absolute` relative to the wrapper instead of `position: fixed` / relative to body.

**Actions:**
- Edit `ChatPanel.vue`: add `position: relative` to `.chat-messages-wrapper`
- Edit `ChatPanel.vue`: add scoped CSS override for the `UChatMessages` viewport/autoScroll slot to position it absolutely within the wrapper, centered horizontally, near the bottom

**Files modified:**
- `app/components/ChatPanel.vue`

**Dependencies:** Step 2 (the `i-lucide-arrow-down` icon must be bundled for the button to show its icon).

---

## Step 4: Visual verification

Verify all fixes work together by running the dev server.

**Actions:**
- Run `pnpm tauri dev` (or `pnpm dev` for frontend-only)
- Verify: Anthropic logo visible in model selector
- Verify: GitHub logo visible in project info bar
- Verify: YOLO zap icon visible in permission mode selector
- Verify: Scroll-to-bottom button visible, centered in chat panel, icon renders
- Verify: Send button (arrow-up) icon visible in chat prompt
- Verify: Kanban column icons (lightbulb, code, search-check, circle-check) all render

**Files modified:** None.

**Dependencies:** Steps 1-3 complete.

---

## Summary

| Step | Requirement | Files | Depends on |
|------|------------|-------|------------|
| 1. Install simple-icons | R1 | `package.json` | — |
| 2. Add icon include list | R2 | `nuxt.config.ts` | Step 1 |
| 3. Fix scroll button CSS | R3 | `app/components/ChatPanel.vue` | Step 2 |
| 4. Visual verification | R1, R2, R3 | — | Steps 1-3 |
