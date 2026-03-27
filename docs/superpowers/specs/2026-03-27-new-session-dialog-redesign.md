# UI Improvements

General UI/UX improvements across the OnCraft application. Includes visual redesigns, Nuxt UI v4.6 API compliance fixes, and component modernization.

## 1. New Session Dialog Redesign

### Problem

The current "New Session" dialog (`NewSessionDialog.vue`) looks visually unpolished:

- Dialog is too narrow (360px), inputs feel cramped
- The Blank/From Issue toggle uses raw `UButton` pair with `size="xs"` — buttons are too thin and text doesn't center properly
- Text inputs don't span the full dialog width
- The checkbox label ("Isolated workspace (git worktree)") is verbose and disconnected from the form
- Overall spacing is inconsistent
- Footer buttons are inside `#body` instead of using the proper `#footer` slot

### Requirements

#### R1.1: Increase dialog width to 440px

Update `UModal` ui prop from `sm:max-w-[360px]` to `sm:max-w-[440px]`.

#### R1.2: Replace mode toggle with UTabs (Nuxt UI v4.6)

Replace the two-button toggle with `UTabs` component:

- Use `:content="false"` to disable content panels (we control visibility via `v-if` on mode ref)
- Items array of `TabsItem` (imported from `@nuxt/ui`) with `label`/`value` fields
- `v-model` bound to mode ref (values: `'blank'`, `'issue'`)
- Only shown when `githubRepo` is configured (same condition as current toggle)
- `class="w-full"` to span dialog width

```typescript
import type { TabsItem } from '@nuxt/ui'

const tabItems: TabsItem[] = [
  { label: 'Blank', value: 'blank' },
  { label: 'From Issue', value: 'issue' }
]
```

#### R1.3: Replace Description input with UTextarea

Replace `UInput` with `UTextarea`:
- `:rows="3"` for 2-3 visible lines
- `class="w-full"` for full width
- Same `v-model`, placeholder, and label

#### R1.4: Replace checkbox with USwitch

Replace `UCheckbox` with `USwitch`:
- Change label from "Isolated workspace (git worktree)" to "Create git worktree"
- Layout: label on the left, switch on the right (flex justify-between with a separate `<span>` for the label — `USwitch`'s built-in `label` prop renders to the right of the switch)

#### R1.5: Move footer to proper UModal #footer slot

- Use `#footer` slot instead of inline buttons inside `#body`
- Slot scope provides `{ close }` function
- Keep pattern: ghost Cancel + solid Create
- `ui="{ footer: 'justify-end' }"` on `UModal` to align buttons right

#### R1.6: Improve spacing

- Increase body gap from `gap-3` to `gap-4`
- Ensure all inputs have `class="w-full"` for full-width rendering

### Acceptance Criteria

- [ ] Dialog renders at 440px max width
- [ ] Mode toggle uses `UTabs` with pill variant when `githubRepo` is provided
- [ ] Mode toggle is hidden when `githubRepo` is not provided
- [ ] Switching tabs between Blank/From Issue works correctly (shows/hides IssueSelector)
- [ ] Description field is a `UTextarea` with 3 rows
- [ ] All inputs (`UInput`, `UTextarea`) span the full dialog width
- [ ] Worktree option uses `USwitch` with label "Create git worktree" (label left, switch right)
- [ ] Cancel and Create buttons are in `#footer` slot, aligned right
- [ ] Create button is disabled when name is empty
- [ ] Cancel closes the dialog
- [ ] Enter key in Name field submits the form
- [ ] `.mode-toggle` custom CSS is removed (replaced by UTabs)
- [ ] No functional regressions: creating sessions in Blank and From Issue modes works as before

### Files affected

- `app/components/NewSessionDialog.vue`

---

## 2. Edit Card Dialog Polish

### Problem

The "Edit Card" dialog (`EditCardDialog.vue`) has similar visual issues to the New Session dialog:

- Inputs (`UInput`, `UTextarea`) don't span the full dialog width
- Body gap is `gap-3` — inconsistent spacing
- Footer uses `#footer` slot (good) but wraps buttons in an unnecessary `<div class="flex justify-end gap-2">` instead of using `ui="{ footer: 'justify-end' }"` on the `UModal`
- Width (420px) is inconsistent with the New Session dialog — should standardize

### Requirements

#### R3.1: Standardize dialog width to 440px

Update `UModal` ui prop from `sm:max-w-[420px]` to `sm:max-w-[440px]` for consistency with New Session dialog.

#### R3.2: Make inputs full-width

Add `class="w-full"` to:
- `UInput` for title field
- `UTextarea` for description field

#### R3.3: Simplify footer layout

Remove the `<div class="flex justify-end gap-2">` wrapper inside `#footer`. Instead, use `ui="{ footer: 'justify-end' }"` on the `UModal` and place buttons directly in the slot.

#### R3.4: Improve spacing

Increase body gap from `gap-3` to `gap-4`.

### Acceptance Criteria

- [ ] Dialog renders at 440px max width
- [ ] Title input and Description textarea span full dialog width
- [ ] Footer buttons are aligned right via `UModal` `ui.footer` prop (no wrapper div)
- [ ] Body gap is `gap-4`
- [ ] Save button is disabled when title is empty
- [ ] No functional regressions: editing cards saves correctly

### Files affected

- `app/components/EditCardDialog.vue`

---

## 3. Nuxt UI v4.6 API Compliance Fixes

### Problem

Several components use deprecated or removed Nuxt UI props that were valid in v2/v3 but removed in v4:

- **`:padded="false"` removed** — The `padded` prop was removed from `UButton` in v4. The replacement is the `square` prop.
- **`size="2xs"` invalid** — `UButton` in v4 only supports sizes `xs`, `sm`, `md`, `lg`, `xl`. The `2xs` size does not exist.

### Requirements

#### R3.1: Replace `:padded="false"` with `square` on UButton

All `UButton` instances using `:padded="false"` must be migrated to use the `square` prop instead.

Affected files and locations:

| File | Usage |
|---|---|
| `ConsolePanel.vue` | Close button: `icon="i-lucide-x"`, `:padded="false"` |
| `ChatPanel.vue` | Close button: `icon="i-lucide-x"`, `:padded="false"` |
| `TabBar.vue` | Close tab button: `icon="i-lucide-x"`, `:padded="false"` |
| `TabBar.vue` | Add project button: `icon="i-lucide-plus"`, `:padded="false"` |
| `TabBar.vue` | Project settings button: `icon="i-lucide-sliders-horizontal"`, `:padded="false"` |

#### R3.2: Replace `size="2xs"` with `size="xs"` on UButton

| File | Usage |
|---|---|
| `ImageAttachmentBar.vue` | Remove button: `size="2xs"` → `size="xs"` |

### Acceptance Criteria

- [ ] No `UButton` in the codebase uses `:padded="false"` — all replaced with `square`
- [ ] No `UButton` in the codebase uses `size="2xs"` — all replaced with `size="xs"`
- [ ] Visual appearance of affected buttons remains functionally equivalent (icon-only buttons with equal padding)
- [ ] No console warnings related to deprecated Nuxt UI props

### Files affected

- `app/components/ConsolePanel.vue`
- `app/components/ChatPanel.vue`
- `app/components/TabBar.vue`
- `app/components/ImageAttachmentBar.vue`

---

## Nuxt UI v4.6.0 Component Reference

Component names and APIs verified against Nuxt UI v4.6 documentation:

| Component | Key Props (v4) |
|---|---|
| `UTabs` | `items: TabsItem[]`, `variant: "pill" \| "link"`, `:content`, `v-model`, `valueKey`, `labelKey` |
| `USwitch` | `v-model` (boolean), `label`, `description`, `color`, `size`, `disabled` |
| `UModal` | `v-model:open`, `title`, `ui: { width, footer }`, slots: `#body`, `#footer({ close })` |
| `UTextarea` | `v-model`, `placeholder`, `:rows`, `class` |
| `UFormField` | `label` |
| `UButton` | `variant`, `color`, `size` (xs-xl), `square`, `block`, `icon`, `loading`, `disabled` |
| `UInput` | `v-model`, `placeholder`, `autofocus`, `class`, `size` |
| `UBadge` | `variant`, `color`, `size`, `icon`, `label` |
| `USelectMenu` | `v-model`, `:items`, `value-key`, `variant`, `size`, `:search-input` |
| `USkeleton` | `as`, `ui` |
| `UContextMenu` | `v-model:open`, `:items` |
| `UCheckbox` | `v-model`, `label` |
| `UIcon` | `name`, `class` |
| `UTooltip` | `text` |

### Removed/Changed in v4 (migration from v3)

| Removed | Replacement |
|---|---|
| `UButton` `:padded` prop | `UButton` `square` prop |
| `UButton` `size="2xs"` | Use `size="xs"` (minimum size in v4) |
| `UInput` `v-model.nullify` | `UInput` `v-model.nullable` |

## Constraints

- **Visual-only**: No changes to data model, sidecar protocol, or business logic
- **Nuxt UI v4.6.0**: Must use v4 component APIs (not v2/v3)
- **No new dependencies**: All components are already available in the project

## Out of Scope

- IssueSelector component styling (separate improvement)
- Changes to the sidecar or data model
- New functionality beyond visual improvements
