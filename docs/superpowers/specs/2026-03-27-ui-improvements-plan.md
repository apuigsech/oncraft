# UI Improvements — Implementation Plan

Based on spec: `docs/superpowers/specs/2026-03-27-new-session-dialog-redesign.md`

## Overview

3 independent workstreams, ordered by complexity (simplest first). No dependencies between steps — they touch different files and can be done in any order. Ordered this way so quick wins land first.

---

## Step 1: Nuxt UI v4.6 API Compliance Fixes

**Spec section**: 3 (R3.1, R3.2)
**Risk**: Low — mechanical find-and-replace
**Files to modify**: 4

### 1a. Replace `:padded="false"` with `square` in TabBar.vue

3 occurrences:
- Close tab button (line ~with `icon="i-lucide-x"`)
- Add project button (`icon="i-lucide-plus"`)
- Project settings button (`icon="i-lucide-sliders-horizontal"`)

Change: `:padded="false"` → `square`

### 1b. Replace `:padded="false"` with `square` in ChatPanel.vue

1 occurrence:
- Close button (`icon="i-lucide-x"`)

Change: `:padded="false"` → `square`

### 1c. Replace `:padded="false"` with `square` in ConsolePanel.vue

1 occurrence:
- Close button (`icon="i-lucide-x"`)

Change: `:padded="false"` → `square`

### 1d. Replace `size="2xs"` with `size="xs"` in ImageAttachmentBar.vue

1 occurrence:
- Remove attachment button

Change: `size="2xs"` → `size="xs"`

### Verification

- Grep codebase for `:padded` and `"2xs"` — expect 0 results
- Visual check: icon-only buttons still render with equal padding

---

## Step 2: Edit Card Dialog Polish

**Spec section**: 2 (R3.1–R3.4)
**Risk**: Low — small prop/class changes
**Files to modify**: 1

### 2a. Update UModal props in EditCardDialog.vue

- Change `ui` prop: `{ width: 'sm:max-w-[420px]' }` → `{ width: 'sm:max-w-[440px]', footer: 'justify-end' }`

### 2b. Make inputs full-width

- Add `class="w-full"` to `UInput` (title field, line 65)
- Add `class="w-full"` to `UTextarea` (description field, line 68)

### 2c. Simplify footer

- Remove the `<div class="flex justify-end gap-2">` wrapper inside `#footer`
- Place `UButton` elements directly inside the `#footer` slot

### 2d. Increase spacing

- Change body div from `gap-3` to `gap-4`

### Verification

- Open Edit Card dialog — inputs should span full width
- Footer buttons aligned right without wrapper div
- Save/Cancel still work

---

## Step 3: New Session Dialog Redesign

**Spec section**: 1 (R1.1–R1.6)
**Risk**: Medium — replaces multiple components, needs careful testing of both Blank and From Issue modes
**Files to modify**: 1

### 3a. Update UModal props in NewSessionDialog.vue

- Change `ui` prop: `{ width: 'sm:max-w-[360px]' }` → `{ width: 'sm:max-w-[440px]', footer: 'justify-end' }`

### 3b. Add TabsItem import and define items

In `<script setup>`:

```typescript
import type { TabsItem } from '@nuxt/ui'

const tabItems: TabsItem[] = [
  { label: 'Blank', value: 'blank' },
  { label: 'From Issue', value: 'issue' }
]
```

### 3c. Replace button toggle with UTabs

Remove the `<div v-if="githubRepo" class="mode-toggle">` block with its two `UButton` children.

Replace with:
```vue
<UTabs
  v-if="githubRepo"
  v-model="mode"
  :items="tabItems"
  :content="false"
  class="w-full"
/>
```

### 3d. Replace Description UInput with UTextarea

Change:
```vue
<UFormField label="Description (optional)">
  <UInput v-model="description" placeholder="Brief description..." @keydown.enter="submit" />
</UFormField>
```

To:
```vue
<UFormField label="Description (optional)">
  <UTextarea v-model="description" :rows="3" placeholder="Brief description..." class="w-full" />
</UFormField>
```

Note: Remove `@keydown.enter="submit"` from UTextarea — Enter should add a newline in a textarea, not submit.

### 3e. Replace UCheckbox with USwitch

Change:
```vue
<UCheckbox v-model="useWorktree" label="Isolated workspace (git worktree)" />
```

To:
```vue
<div class="flex items-center justify-between">
  <span class="text-sm text-[var(--text-secondary)]">Create git worktree</span>
  <USwitch v-model="useWorktree" />
</div>
```

### 3f. Move footer from #body to #footer slot

Remove the inline footer div from inside `#body` template.

Add a new `#footer` slot:
```vue
<template #footer>
  <UButton variant="ghost" color="neutral" @click="cancel">Cancel</UButton>
  <UButton :disabled="!name.trim()" @click="submit">Create</UButton>
</template>
```

### 3g. Improve spacing and input widths

- Change body div from `gap-3` to `gap-4`
- Add `class="w-full"` to Name `UInput`

### 3h. Remove .mode-toggle CSS

Delete the `.mode-toggle` rule from `<style scoped>` (no longer needed — UTabs handles its own styling).

### Verification

- Open New Session dialog without `githubRepo` — tabs should be hidden, form works normally
- Open with `githubRepo` — tabs visible, switching between Blank/From Issue works
- In From Issue mode: selecting an issue pre-fills name and description
- Name field Enter key submits
- Description is a 3-row textarea
- Worktree toggle works (label left, switch right)
- Cancel closes dialog
- Create disabled when name empty, enabled when filled
- Dialog is 440px wide

---

## Commit Strategy

One commit per step:
1. `fix(ui): replace deprecated Nuxt UI v4 props (padded, 2xs)`
2. `fix(ui): polish EditCardDialog width, spacing, and footer`
3. `feat(ui): redesign NewSessionDialog with UTabs, USwitch, UTextarea`
