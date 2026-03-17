# Image Attachments in Chat

## Summary

Add support for attaching images to chat messages in ClaudBan's integrated chat mode. Users can paste from clipboard (Cmd+V), drag and drop, or use a file picker dialog. Images are sent as base64 content blocks to the Claude Agent SDK for multimodal analysis.

## Motivation

Claude's API supports multimodal input (text + images). ClaudBan's integrated chat currently only sends plain text prompts. Users need to share screenshots, mockups, diagrams, or photos with Claude for analysis, feedback, or context.

## Approach

Base64 inline via JSON-lines. Images are converted to base64 in the frontend and included in the `start` command sent to the sidecar over stdin. The sidecar constructs multimodal content blocks for the SDK. No filesystem temp files or architectural changes needed.

## Data Model

### New type: `ImageAttachment`

```typescript
// app/types/index.ts
export interface ImageAttachment {
  id: string;           // crypto.randomUUID()
  data: string;         // base64-encoded image data (no data: prefix)
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  name: string;         // original filename or "pasted-image.png"
  size: number;         // bytes of the original file
}
```

### StreamMessage change

Add optional `images` field:

```typescript
export interface StreamMessage {
  // ... existing fields unchanged ...
  images?: ImageAttachment[];
}
```

### Supported formats and limits

Match the Anthropic API constraints directly:
- Formats: JPEG, PNG, GIF, WebP
- Max size per image: 20MB
- No artificial limits beyond what the API enforces

## Sidecar Protocol

### Command: `start` with images

The `start` command gains an optional `images` array:

```json
{
  "cmd": "start",
  "prompt": "Analyze this screenshot",
  "images": [
    { "data": "iVBOR...", "mediaType": "image/png" }
  ],
  "projectPath": "/path/to/project",
  "sessionId": "..."
}
```

### Sidecar handling (agent-bridge.ts)

When `cmd.images` is present and non-empty, the sidecar constructs an `SDKUserMessage` with mixed content blocks instead of a plain string prompt:

```typescript
const contentBlocks = [];
for (const img of cmd.images) {
  contentBlocks.push({
    type: 'image',
    source: { type: 'base64', media_type: img.mediaType, data: img.data }
  });
}
contentBlocks.push({ type: 'text', text: cmd.prompt });

const promptValue: SDKUserMessage = {
  type: 'user',
  message: { role: 'user', content: contentBlocks },
  parent_tool_use_id: null,
  session_id: '',
};
```

When no images are present, behavior is unchanged (prompt as plain string).

### History translation

In `translateMessage()`, when processing `msg.type === 'user'` content blocks of type `image`, extract the base64 data and include an `images` array in the translated message:

```typescript
if (block.type === 'image') {
  const source = block.source;
  if (source.type === 'base64') {
    images.push({
      data: source.data,
      mediaType: source.media_type,
      name: 'image',
    });
  }
}
```

## Frontend: Input

### State management

Pending attachments are local state in `ChatPanel.vue` (`ref<ImageAttachment[]>`). They are ephemeral and only exist until the message is sent. Not stored in Pinia.

### Three input methods

All three converge on the same `addAttachment(file: File)` function:

| Method | Event | Detail |
|--------|-------|--------|
| Clipboard paste | `paste` on textarea | Reads `clipboardData.items`, filters for image types |
| Drag and drop | `dragover`/`drop` on the chat input area | Shows drop zone overlay, processes image files on drop |
| File picker | Click on paperclip button | Opens Tauri `dialog.open()` with image file filters |

### `addAttachment(file: File)` logic

1. Validate `file.type` is one of the four supported media types
2. Validate `file.size <= 20MB`
3. Read file as base64 via `FileReader.readAsDataURL()`, strip the `data:...;base64,` prefix
4. Create `ImageAttachment` with `crypto.randomUUID()` id
5. Append to local `pendingAttachments` array
6. On validation failure, show error toast via `useToast()`

### New component: `ImageAttachmentBar.vue`

Renders above the textarea when there are pending attachments.

Props:
- `attachments: ImageAttachment[]`

Emits:
- `remove(id: string)`

Each attachment renders as:
- Thumbnail (48x48px, `object-fit: cover`, `border-radius: 6px`)
- Truncated filename
- Close button (x) to remove

Only visible when `attachments.length > 0`.

### Attach button

A paperclip icon (`i-lucide-paperclip`) placed in the `UChatPrompt` slot alongside the submit button. Opens Tauri's native file dialog filtered to `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`.

### Send flow

`sendMessage()` in `ChatPanel.vue`:
1. Collects `input.value` (text) and `pendingAttachments` (images)
2. Calls `sessionsStore.send(cardId, text, images)`
3. Clears both `input` and `pendingAttachments`

## Frontend: Sessions Store

### `send()` signature change

```typescript
async function send(cardId: string, message: string, images?: ImageAttachment[]): Promise<void>
```

- Appends user message with `images` to the message list
- Passes `images` through to `sendStart()` / `spawnSession()`

### `claude-process.ts` changes

`spawnSession()` and `sendStart()` include `images` in the JSON `start` command when present:

```typescript
const startCmd = JSON.stringify({
  cmd: 'start',
  prompt,
  projectPath,
  ...(images?.length ? { images: images.map(i => ({ data: i.data, mediaType: i.mediaType })) } : {}),
  // ... existing fields ...
});
```

## Frontend: Message Display

### New UI part type

```typescript
// app/services/message-adapter.ts
export interface ImageUIPart {
  type: 'image';
  data: string;       // base64
  mediaType: string;
  name: string;
}

export type UIMessagePart = TextUIPart | ReasoningUIPart | ToolInvocationUIPart | ImageUIPart;
```

### `toUIMessages()` change

For user messages with images, generate `ImageUIPart` entries before the text part:

```typescript
if (msg.type === 'user') {
  const parts: UIMessagePart[] = [];
  if (msg.images?.length) {
    for (const img of msg.images) {
      parts.push({ type: 'image', data: img.data, mediaType: img.mediaType, name: img.name });
    }
  }
  parts.push({ type: 'text', text: msg.content });
  result.push({ id: `user-${i}`, role: 'user', parts });
}
```

### ChatPanel.vue rendering

New block in the `#content` template slot:

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

Styling: `max-width: 300px`, `max-height: 300px`, `border-radius: 8px`, `object-fit: contain`.

### History reload

`loadHistoryViaSidecar()` in `claude-process.ts` maps the `images` field from translated messages to `StreamMessage.images`.

## Files Changed

| File | Change |
|------|--------|
| `app/types/index.ts` | Add `ImageAttachment` interface, add `images?` to `StreamMessage` |
| `app/components/ImageAttachmentBar.vue` | **New** -- thumbnail bar with remove buttons |
| `app/components/ChatPanel.vue` | Pending attachments state, paste/drop/dialog handlers, attach button, image rendering in messages |
| `app/stores/sessions.ts` | `send()` accepts and propagates `images` parameter |
| `app/services/claude-process.ts` | `spawnSession()`/`sendStart()` include images in JSON command |
| `app/services/message-adapter.ts` | Add `ImageUIPart`, update `toUIMessages()` for image parts |
| `src-sidecar/agent-bridge.ts` | Build multimodal content blocks in `start` handler, extract images in `translateMessage()` |

## Out of Scope

- Image lightbox/zoom on click
- PDF or non-image file attachments
- Automatic image compression or resizing
- Image support in console mode (xterm.js)
- Drag and drop of image files from the OS file manager onto the Kanban board (only chat input area)
