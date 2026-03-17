# Implementation Plan: Image Attachments in Chat

**Spec:** `docs/superpowers/specs/2026-03-17-image-attachments-design.md`

## Overview

7 tasks in 4 phases. Each phase builds on the previous. Phase 1 (types + sidecar) can be validated independently. Phases 2-3 build the frontend. Phase 4 wires everything together.

## Phase 1: Data Model + Sidecar (backend-first)

### Task 1: Add types

**File:** `app/types/index.ts`

1. Add `ImageAttachment` interface:
   ```typescript
   export interface ImageAttachment {
     id: string;
     data: string;
     mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
     name: string;
     size: number;
   }
   ```
2. Add `images?: ImageAttachment[]` field to `StreamMessage` interface

**Verify:** TypeScript compiles (`pnpm build` or IDE check)

### Task 2: Update sidecar to handle multimodal prompts

**File:** `src-sidecar/agent-bridge.ts`

1. In the `cmd === "start"` handler, before calling `query()`:
   - Check if `cmd.images` exists and is a non-empty array
   - If yes, build content blocks array: image blocks first, then text block
   - Construct an `SDKUserMessage` object with the content blocks as `message.content`
   - Pass this as `prompt` to `query()` instead of the plain string
   - If no images, keep current behavior (plain string prompt)

2. In `translateMessage()`, in the `msg.type === 'user'` branch:
   - When iterating content blocks, detect `block.type === 'image'`
   - Extract `source.data` and `source.media_type` from base64 image blocks
   - Collect into an `images` array
   - Include `images` in the translated message object alongside `content`

**Verify:** Rebuild sidecar (`pnpm build:sidecar`), manually test by sending a JSON-line with images to stdin

## Phase 2: Frontend Input Infrastructure

### Task 3: Create `ImageAttachmentBar.vue` component

**File:** `app/components/ImageAttachmentBar.vue` (new)

1. Props: `attachments: ImageAttachment[]`
2. Emits: `remove(id: string)`
3. Template: horizontal flex container, each item shows:
   - `<img>` thumbnail (48x48px, `object-fit: cover`, `border-radius: 6px`) using `data:${mediaType};base64,${data}` src
   - Filename truncated to ~20 chars
   - UButton with `i-lucide-x` icon, ghost variant, emits `remove`
4. Container hidden when `attachments.length === 0`
5. Scoped CSS: flex row, gap 8px, padding 8px, subtle background matching chat input area

**Verify:** Component renders in isolation (add temporary test data in ChatPanel)

### Task 4: Add image input handlers to ChatPanel.vue

**File:** `app/components/ChatPanel.vue`

1. Add local state:
   ```typescript
   const pendingAttachments = ref<ImageAttachment[]>([]);
   ```

2. Add `addAttachment(file: File)` function:
   - Validate `file.type` is one of `image/jpeg`, `image/png`, `image/gif`, `image/webp`
   - Validate `file.size <= 20 * 1024 * 1024` (20MB)
   - On failure: show error toast via `useToast()`
   - On success: read file via `FileReader.readAsDataURL()`, strip `data:...;base64,` prefix
   - Create `ImageAttachment` with `crypto.randomUUID()`, push to `pendingAttachments`

3. Add `removeAttachment(id: string)` function:
   - Filter out the attachment with matching id

4. Add clipboard paste handler:
   - Listen for `paste` event on the textarea (or chat input area wrapper)
   - Read `event.clipboardData.items`, find items with `type.startsWith('image/')`
   - Call `item.getAsFile()`, then `addAttachment(file)`

5. Add drag and drop handlers:
   - `dragover`: prevent default, add visual indicator class
   - `dragleave`: remove visual indicator
   - `drop`: prevent default, iterate `event.dataTransfer.files`, call `addAttachment()` for each image

6. Add file picker button:
   - Import `open` from `@tauri-apps/plugin-dialog` and `readFile` from `@tauri-apps/plugin-fs`
   - On click: `open({ filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }], multiple: true })`
   - Read each selected file, convert to base64, call `addAttachment()`
   - Note: Tauri dialog returns file paths, so read the file bytes with `readFile()` and convert to base64

7. Template changes:
   - Add `<ImageAttachmentBar>` above the `<UChatPrompt>`, inside `.chat-input-area`
   - Add paperclip button (`i-lucide-paperclip`) in the `UChatPrompt` default slot, before the submit button
   - Add drop zone class/overlay on the input area

**Verify:** Paste an image, drag an image, use the picker -- thumbnails appear in the bar. Remove works.

## Phase 3: Message Display

### Task 5: Update message adapter for image parts

**File:** `app/services/message-adapter.ts`

1. Add `ImageUIPart` interface:
   ```typescript
   export interface ImageUIPart {
     type: 'image';
     data: string;
     mediaType: string;
     name: string;
   }
   ```
2. Add `ImageUIPart` to the `UIMessagePart` union type
3. In `toUIMessages()`, update the `msg.type === 'user'` branch:
   - If `msg.images?.length`, create `ImageUIPart` entries before the text part
   - Push all parts (images + text) into the message

**Verify:** TypeScript compiles, adapter produces image parts for messages with images

### Task 6: Render image parts in ChatPanel.vue

**File:** `app/components/ChatPanel.vue`

1. In the `#content` template slot, add handling for `part.type === 'image'`:
   ```vue
   <template v-if="part.type === 'image'">
     <div class="chat-image">
       <img
         :src="`data:${part.mediaType};base64,${part.data}`"
         :alt="part.name"
         loading="lazy"
       />
     </div>
   </template>
   ```
2. Add CSS: `.chat-image img` with `max-width: 300px`, `max-height: 300px`, `border-radius: 8px`, `object-fit: contain`

**Verify:** Send a message with images, they appear rendered in the chat history

## Phase 4: Wire Everything Together

### Task 7: Connect send flow end-to-end

**Files:** `app/stores/sessions.ts`, `app/services/claude-process.ts`

1. **`sessions.ts`** -- Update `send()`:
   - Change signature to `send(cardId: string, message: string, images?: ImageAttachment[])`
   - Pass `images` in the `appendMessage()` call for the user message
   - Pass `images` to `sendStart()` and `spawnSession()`

2. **`claude-process.ts`** -- Update `spawnSession()` and `sendStart()`:
   - Add `images?: ImageAttachment[]` parameter
   - Include `images` (mapped to `{ data, mediaType }`) in the JSON `start` command

3. **`claude-process.ts`** -- Update `loadHistoryViaSidecar()`:
   - Map `images` from the raw translated message to `StreamMessage.images`

4. **`ChatPanel.vue`** -- Update `sendMessage()`:
   - Pass `pendingAttachments.value` to `sessionsStore.send()`
   - Clear `pendingAttachments` after sending

**Verify:** Full end-to-end test:
- Paste an image in the chat input, see thumbnail preview
- Type a message, press Enter
- Image + text appear in the chat as a user message
- Claude responds with analysis of the image
- Reload the chat -- images appear from history

## Task Dependency Graph

```
Task 1 (types)
  ├─> Task 2 (sidecar)
  ├─> Task 3 (ImageAttachmentBar)
  └─> Task 5 (message adapter)

Task 3 ──> Task 4 (ChatPanel input handlers)
Task 5 ──> Task 6 (ChatPanel rendering)

Task 2 + Task 4 + Task 6 ──> Task 7 (wire end-to-end)
```

Tasks 2, 3, and 5 can be done in parallel after Task 1.
Tasks 4 and 6 can be done in parallel after their respective dependencies.
Task 7 is the final integration.

## Estimated Scope

- ~7 files modified, 1 new file
- ~300-400 lines of new/changed code
- No new dependencies
- No database migrations
