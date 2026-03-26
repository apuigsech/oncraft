<script setup lang="ts">
import { registry } from '~/services/chat-part-registry';
import type { ChatPart, ImageAttachment } from '~/types';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';

const sessionsStore = useSessionsStore();
const cardsStore = useCardsStore();
const input = ref('');

// ─── Image attachments ───
const pendingAttachments = ref<ImageAttachment[]>([]);
const isDragOver = ref(false);
const SUPPORTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB

const toast = useToast();

function addAttachmentFromFile(file: File): void {
  if (!SUPPORTED_TYPES.has(file.type)) {
    toast.add({ title: 'Unsupported image format', description: `${file.type || 'unknown'} is not supported. Use JPEG, PNG, GIF, or WebP.`, color: 'error' });
    return;
  }
  if (file.size > MAX_IMAGE_SIZE) {
    toast.add({ title: 'Image too large', description: `${(file.size / 1024 / 1024).toFixed(1)}MB exceeds the 20MB limit.`, color: 'error' });
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result as string;
    const base64 = dataUrl.split(',')[1];
    if (!base64) return;
    pendingAttachments.value.push({
      id: crypto.randomUUID(),
      data: base64,
      mediaType: file.type as ImageAttachment['mediaType'],
      name: file.name || 'pasted-image.png',
      size: file.size,
    });
  };
  reader.readAsDataURL(file);
}

function removeAttachment(id: string): void {
  pendingAttachments.value = pendingAttachments.value.filter(a => a.id !== id);
}

function handlePaste(event: ClipboardEvent): void {
  const items = event.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        event.preventDefault();
        addAttachmentFromFile(file);
      }
    }
  }
}

function handleDragOver(event: DragEvent): void {
  event.preventDefault();
  isDragOver.value = true;
}

function handleDragLeave(): void {
  isDragOver.value = false;
}

function handleDrop(event: DragEvent): void {
  event.preventDefault();
  isDragOver.value = false;
  const files = event.dataTransfer?.files;
  if (!files) return;
  for (const file of files) {
    if (file.type.startsWith('image/')) {
      addAttachmentFromFile(file);
    }
  }
}

async function openFilePicker(): Promise<void> {
  try {
    const selected = await openDialog({
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }],
      multiple: true,
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    for (const filePath of paths) {
      const bytes = await readFile(filePath);
      const ext = filePath.split('.').pop()?.toLowerCase() || '';
      const mediaTypeMap: Record<string, string> = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
        gif: 'image/gif', webp: 'image/webp',
      };
      const mediaType = mediaTypeMap[ext];
      if (!mediaType) continue;
      if (bytes.length > MAX_IMAGE_SIZE) {
        toast.add({ title: 'Image too large', description: `File exceeds the 20MB limit.`, color: 'error' });
        continue;
      }
      // Convert Uint8Array to base64
      let binary = '';
      const chunk = 8192;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      const base64 = btoa(binary);
      const name = filePath.split('/').pop() || filePath.split('\\').pop() || 'image';
      pendingAttachments.value.push({
        id: crypto.randomUUID(),
        data: base64,
        mediaType: mediaType as ImageAttachment['mediaType'],
        name,
        size: bytes.length,
      });
    }
  } catch (err) {
    // User cancelled or error
    if (import.meta.dev) console.warn('[OnCraft] file picker error:', err);
  }
}

const showSlashPalette = computed(() => {
  return input.value.startsWith('/') && !input.value.includes(' ');
});

const card = computed(() => {
  if (!sessionsStore.activeChatCardId) return null;
  return cardsStore.cards.find(c => c.id === sessionsStore.activeChatCardId) || null;
});

const { headerParts, inlineParts, actionBarParts, progressParts, chatStatus, isActive } = useChatParts(
  computed(() => sessionsStore.activeChatCardId)
);
const uiMessages = useUIMessages(computed(() => inlineParts.value));

const metrics = computed(() => {
  if (!sessionsStore.activeChatCardId) return { inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: 0 };
  return sessionsStore.getSessionMetrics(sessionsStore.activeChatCardId);
});

const sessionConfig = computed(() => {
  if (!sessionsStore.activeChatCardId) return { model: 'sonnet' as const, effort: 'high' as const, permissionMode: 'default' as const };
  return sessionsStore.getSessionConfig(sessionsStore.activeChatCardId);
});

// ─── Component resolution for dynamic zones ───
const componentMap: Record<string, any> = {
  MarkdownContent: resolveComponent('MarkdownContent'),
  UserMessageBlock: resolveComponent('UserMessageBlock'),
  ToolCallBlock: resolveComponent('ToolCallBlock'),
  ToolApprovalBar: resolveComponent('ToolApprovalBar'),
  UserQuestionBar: resolveComponent('UserQuestionBar'),
  PromptSuggestionBar: resolveComponent('PromptSuggestionBar'),
  HookActivityBlock: resolveComponent('HookActivityBlock'),
  ErrorNotice: resolveComponent('ErrorNotice'),
  RateLimitNotice: resolveComponent('RateLimitNotice'),
  TaskListDisplay: resolveComponent('TaskListDisplay'),
  GenericMessageBlock: resolveComponent('GenericMessageBlock'),
};

function getComponent(kind: string): any {
  const def = registry[kind] || registry['_default'];
  const name = def?.component || 'GenericMessageBlock';
  return componentMap[name] || componentMap['GenericMessageBlock'];
}

// Find a ChatPart by toolCallId for tool invocation rendering
function findToolPart(uiPart: any): ChatPart {
  const found = inlineParts.value.find(p =>
    (p.kind === 'tool_use' || p.kind === 'tool_confirmation') &&
    p.data.toolUseId === uiPart.toolCallId
  );
  return found || { id: uiPart.toolCallId, kind: 'tool_use', placement: 'inline', timestamp: Date.now(), data: { toolName: uiPart.toolName, toolInput: uiPart.input, toolUseId: uiPart.toolCallId, toolResult: uiPart.output } };
}

function sendMessage() {
  const hasText = input.value.trim().length > 0;
  const hasImages = pendingAttachments.value.length > 0;
  if (!hasText && !hasImages) return;
  if (!sessionsStore.activeChatCardId) return;
  const cardId = sessionsStore.activeChatCardId;
  const msg = input.value.trim() || (hasImages ? 'Here are the attached images.' : '');
  const images = hasImages ? [...pendingAttachments.value] : undefined;
  input.value = '';
  pendingAttachments.value = [];
  // Sending a message always resets sticky-scroll to bottom
  isAtBottom.value = true;
  nextTick(scrollToBottom);
  sessionsStore.send(cardId, msg, images);
}

function handleStop() {
  if (sessionsStore.activeChatCardId) {
    sessionsStore.interruptSession(sessionsStore.activeChatCardId);
  }
}

function selectSlashCommand(command: string) {
  input.value = command + ' ';
}

// Preserve scroll position when the task list collapses/expands
const headerZoneEl = ref<HTMLElement | null>(null);

function onTaskListToggle() {
  const wrapper = messagesWrapper.value;
  const taskEl = headerZoneEl.value;
  if (!wrapper || !taskEl) return;

  // Capture current state before the DOM updates
  const oldHeight = taskEl.offsetHeight;
  const wasAtBottom = wrapper.scrollTop + wrapper.clientHeight >= wrapper.scrollHeight - 2;

  nextTick(() => {
    if (wasAtBottom) {
      // If user was at bottom, stay at bottom
      wrapper.scrollTop = wrapper.scrollHeight;
    } else {
      // Compensate: the flex container redistributed space, adjust scrollTop by the height delta
      const delta = taskEl.offsetHeight - oldHeight;
      wrapper.scrollTop = Math.max(0, wrapper.scrollTop + delta);
    }
  });
}

// ─── Sticky-scroll ───
// We own all scroll logic. UChatMessages' internal auto-scroll is disabled
// (:should-auto-scroll="false") and --last-message-height is neutralized via CSS.
// A MutationObserver on the wrapper catches every DOM change in the subtree
// (streaming tokens, new messages, tool blocks) — not just message-count changes.
const messagesWrapper = ref<HTMLElement | null>(null);

const SCROLL_THRESHOLD = 80; // px from bottom considered "at bottom"
const isAtBottom = ref(true);

function checkIfAtBottom() {
  const el = messagesWrapper.value;
  if (!el) return;
  isAtBottom.value = el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_THRESHOLD;
}

function scrollToBottom() {
  const el = messagesWrapper.value;
  if (!el) return;
  el.scrollTop = el.scrollHeight;
  isAtBottom.value = true;
}

// MutationObserver on the wrapper: fires on ANY DOM change in the subtree
// (new message nodes, streaming text tokens, tool block expansion, etc.)
let mutationObserver: MutationObserver | null = null;

function setupMutationObserver() {
  mutationObserver?.disconnect();
  const wrapper = messagesWrapper.value;
  if (!wrapper) return;
  mutationObserver = new MutationObserver(() => {
    if (isAtBottom.value) scrollToBottom();
  });
  mutationObserver.observe(wrapper, { childList: true, subtree: true, characterData: true });
}

// Card switch → always go to bottom
watch(() => sessionsStore.activeChatCardId, () => {
  isAtBottom.value = true;
  nextTick(() => { scrollToBottom(); setupMutationObserver(); });
});

// Initial history load → always go to bottom
watch(() => inlineParts.value.length, (newLen, oldLen) => {
  if (oldLen === 0 && newLen > 0) nextTick(scrollToBottom);
});

onMounted(() => {
  nextTick(() => { scrollToBottom(); setupMutationObserver(); });
});

onUnmounted(() => {
  mutationObserver?.disconnect();
});
</script>

<template>
  <div class="chat-panel">
    <!-- Header -->
    <div class="chat-header">
      <div class="chat-title">
        <strong>{{ card?.name || 'Session' }}</strong>
        <UBadge v-if="card?.columnName" variant="soft" color="neutral" size="sm">
          {{ card.columnName }}
        </UBadge>
      </div>
      <div class="header-metrics">
        <ContextGauge
          :input-tokens="metrics.inputTokens"
          :output-tokens="metrics.outputTokens"
        />
        <SessionMetrics
          :cost-usd="metrics.costUsd"
          :input-tokens="metrics.inputTokens"
          :output-tokens="metrics.outputTokens"
          :duration-ms="metrics.durationMs"
        />
      </div>
      <UButton
        variant="ghost"
        color="neutral"
        size="sm"
        icon="i-lucide-x"
        :padded="false"
        @click="sessionsStore.closeChat()"
      />
    </div>

    <!-- Header Zone -->
    <div v-if="headerParts.length" ref="headerZoneEl" class="task-list-sticky">
      <template v-for="part in headerParts" :key="part.id">
        <component
          :is="getComponent(part.kind)"
          :part="part"
          :card-id="sessionsStore.activeChatCardId!"
          @toggle="onTaskListToggle"
        />
      </template>
    </div>

    <!-- Messages area — sticky-scroll managed by MutationObserver above -->
    <div ref="messagesWrapper" class="chat-messages-wrapper" @scroll.passive="checkIfAtBottom">
      <UChatMessages
        :messages="uiMessages"
        :status="chatStatus"
        :should-auto-scroll="false"
        :should-scroll-to-bottom="false"
        class="chat-messages-inner"
        :ui="{ root: 'gap-4 px-3' }"
        :user="{
          variant: 'subtle',
          side: 'right',
          icon: 'i-lucide-user',
        }"
        :assistant="{
          variant: 'naked',
          side: 'left',
          icon: 'i-lucide-bot',
        }"
      >
        <!-- Custom content rendering per message -->
        <template #content="{ role, parts }">
          <template v-for="(part, idx) in parts" :key="idx">
            <!-- Image parts -->
            <template v-if="part.type === 'image'">
              <div class="chat-image">
                <img
                  :src="`data:${part.mediaType};base64,${part.data}`"
                  :alt="part.name"
                  loading="lazy"
                />
              </div>
            </template>

            <!-- Text parts: user = plain text, assistant = rendered markdown -->
            <template v-else-if="part.type === 'text'">
              <MarkdownContent
                v-if="role === 'assistant'"
                :text="part.text"
                :streaming="part.state === 'streaming'"
              />
              <div v-else-if="role === 'user'" class="user-text">{{ part.text }}</div>
              <div v-else class="system-text">{{ part.text }}</div>
            </template>

            <!-- Reasoning (thinking) — auto-opens during streaming, auto-closes after -->
            <UChatReasoning
              v-else-if="part.type === 'reasoning'"
              :text="part.reasoning"
              :streaming="part.streaming"
              icon="i-lucide-brain"
              :auto-close-delay="800"
            />

            <!-- Tool invocations — delegate to ToolCallBlock via ChatPart -->
            <template v-else-if="part.type === 'dynamic-tool'">
              <ToolCallBlock
                :part="findToolPart(part)"
                :card-id="sessionsStore.activeChatCardId!"
              />
            </template>

            <!-- ChatPart rendered via registry component (resolved actions, etc.) -->
            <template v-else-if="part.type === 'chat-part'">
              <component
                :is="getComponent(part.chatPart.kind)"
                :part="part.chatPart"
                :card-id="sessionsStore.activeChatCardId!"
              />
            </template>
          </template>
        </template>
      </UChatMessages>

      <ChatSkeleton
        v-if="!inlineParts.length && sessionsStore.activeChatCardId && sessionsStore.isLoadingHistory(sessionsStore.activeChatCardId)"
      />
      <EmptyState
        v-else-if="!inlineParts.length"
        icon="i-lucide-message-square"
        title="Start a conversation"
        description="Send a message to begin working with Claude."
      />
    </div>

    <!-- Input area -->
    <div
      class="chat-input-area"
      :class="{ 'drag-over': isDragOver }"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
      @paste="handlePaste"
    >
      <div class="progress-area">
        <AgentProgressBar :parts="progressParts" :is-active="isActive" :card-id="sessionsStore.activeChatCardId!" />
      </div>

      <!-- Action Bar Zone — shows one pending action at a time -->
      <div v-if="actionBarParts" class="action-bar-zone">
        <component
          :is="getComponent(actionBarParts.kind)"
          :part="actionBarParts"
          :card-id="sessionsStore.activeChatCardId!"
        />
      </div>

      <!-- Image attachment previews -->
      <ImageAttachmentBar
        :attachments="pendingAttachments"
        @remove="removeAttachment"
      />

      <!-- Slash command palette — positioned absolutely above the prompt -->
      <SlashCommandPalette
        :filter="input"
        :visible="showSlashPalette"
        :commands="sessionsStore.availableCommands"
        @select="selectSlashCommand"
      />

      <!-- Drop zone overlay -->
      <div v-if="isDragOver" class="drop-overlay">
        <UIcon name="i-lucide-image-plus" class="drop-icon" />
        <span>Drop image here</span>
      </div>

      <!-- UChatPrompt — the main chat input box -->
      <UChatPrompt
        v-model="input"
        :placeholder="isActive ? 'Claude is working...' : 'Message Claude...'"
        :disabled="isActive"
        :rows="1"
        :maxrows="6"
        variant="subtle"
        @submit="sendMessage"
      >
        <!-- Default slot: attach + submit buttons beside textarea -->
        <UButton
          variant="ghost"
          color="neutral"
          size="sm"
          icon="i-lucide-paperclip"
          :padded="false"
          :disabled="isActive"
          @click="openFilePicker"
        />
        <UChatPromptSubmit
          :status="chatStatus"
          color="neutral"
          @stop="handleStop"
        />

        <!-- Footer slot: toolbar controls -->
        <template v-if="card" #footer>
          <InputToolbar
            :model="sessionConfig.model"
            :effort="sessionConfig.effort"
            :permission-mode="sessionConfig.permissionMode"
            :git-branch="sessionConfig.gitBranch"
            :worktree-path="sessionConfig.worktreePath"
            :worktree-branch="sessionConfig.worktreeBranch"
            @update:model="v => card && sessionsStore.updateSessionConfig(card.id, { model: v })"
            @update:effort="v => card && sessionsStore.updateSessionConfig(card.id, { effort: v })"
            @update:permission-mode="v => card && sessionsStore.updateSessionConfig(card.id, { permissionMode: v })"
          />
        </template>
      </UChatPrompt>
    </div>
  </div>
</template>

<style scoped>
.chat-panel {
  min-width: 320px;
  max-width: 600px;
  border-left: 1px solid var(--border);
  background: var(--bg-primary);
  display: flex;
  flex-direction: column;
}
.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-secondary);
}
.chat-title { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.header-metrics { display: flex; align-items: center; gap: 10px; margin-left: auto; margin-right: 10px; }

.task-list-sticky { flex-shrink: 0; border-bottom: 1px solid var(--border); }
.chat-messages-wrapper { flex: 1; overflow-y: auto; }
/* Neutralize UChatMessages' --last-message-height spacer (we own scroll) */
.chat-messages-inner { padding: 12px; --last-message-height: 0px !important; }

.chat-input-area { position: relative; padding: 8px; display: flex; flex-direction: column; gap: 4px; }
.chat-input-area.drag-over { outline: 2px dashed var(--accent); outline-offset: -2px; border-radius: 8px; }
.progress-area { min-height: 0; }

/* Drop zone overlay */
.drop-overlay {
  position: absolute; inset: 0; z-index: 10;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
  background: color-mix(in srgb, var(--bg-primary) 90%, transparent);
  border-radius: 8px; font-size: 13px; color: var(--accent); font-weight: 600;
  pointer-events: none;
}
.drop-icon { width: 32px; height: 32px; }

/* Chat images in messages */
.chat-image { margin: 4px 0; }
.chat-image img { max-width: 300px; max-height: 300px; border-radius: 8px; object-fit: contain; }

/* User text */
.user-text { white-space: pre-wrap; font-size: 13px; line-height: 1.6; word-break: break-word; }
.system-text { font-size: 11px; color: var(--text-muted); text-align: center; padding: 4px; font-style: italic; }

/* ─── Markdown rendering (same as before) ─── */
.markdown-body { font-size: 13px; line-height: 1.6; word-break: break-word; }
.markdown-body :deep(p) { margin: 0 0 8px 0; }
.markdown-body :deep(p:last-child) { margin-bottom: 0; }
.markdown-body :deep(strong) { font-weight: 700; }
.markdown-body :deep(em) { font-style: italic; }
.markdown-body :deep(ul), .markdown-body :deep(ol) { margin: 4px 0 8px 20px; }
.markdown-body :deep(li) { margin-bottom: 2px; }
.markdown-body :deep(h1), .markdown-body :deep(h2), .markdown-body :deep(h3),
.markdown-body :deep(h4), .markdown-body :deep(h5) { margin: 12px 0 6px 0; font-weight: 700; }
.markdown-body :deep(h1) { font-size: 1.3em; }
.markdown-body :deep(h2) { font-size: 1.15em; }
.markdown-body :deep(h3) { font-size: 1.05em; }
.markdown-body :deep(blockquote) { border-left: 3px solid var(--bg-tertiary); margin: 8px 0; padding: 4px 12px; color: var(--text-secondary); }
.markdown-body :deep(hr) { border: none; border-top: 1px solid var(--bg-tertiary); margin: 12px 0; }
.markdown-body :deep(a) { color: var(--accent); text-decoration: none; }
.markdown-body :deep(a:hover) { text-decoration: underline; }
.markdown-body :deep(table) { border-collapse: collapse; margin: 8px 0; font-size: 12px; }
.markdown-body :deep(th), .markdown-body :deep(td) { border: 1px solid var(--bg-tertiary); padding: 4px 8px; }
.markdown-body :deep(th) { background: var(--bg-tertiary); font-weight: 600; }
.markdown-body :deep(.code-block) { position: relative; margin: 8px 0; border-radius: 6px; overflow: hidden; background: #1a1b26; }
.markdown-body :deep(.code-block .code-lang) { position: absolute; top: 4px; right: 8px; font-size: 10px; color: #565f89; font-family: monospace; }
.markdown-body :deep(.code-block pre) { margin: 0; padding: 12px; overflow-x: auto; }
.markdown-body :deep(.code-block code) { font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace; font-size: 12px; line-height: 1.5; }
.markdown-body :deep(.inline-code) { background: var(--bg-tertiary); padding: 1px 5px; border-radius: 3px; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px; }
.markdown-body :deep(.hljs) { color: #a9b1d6; background: transparent; }
.markdown-body :deep(.hljs-keyword) { color: #bb9af7; }
.markdown-body :deep(.hljs-string) { color: #9ece6a; }
.markdown-body :deep(.hljs-number) { color: #ff9e64; }
.markdown-body :deep(.hljs-function) { color: #7aa2f7; }
.markdown-body :deep(.hljs-title) { color: #7aa2f7; }
.markdown-body :deep(.hljs-params) { color: #e0af68; }
.markdown-body :deep(.hljs-comment) { color: #565f89; font-style: italic; }
.markdown-body :deep(.hljs-built_in) { color: #7dcfff; }
.markdown-body :deep(.hljs-type) { color: #2ac3de; }
.markdown-body :deep(.hljs-attr) { color: #7aa2f7; }
.markdown-body :deep(.hljs-variable) { color: #c0caf5; }
.markdown-body :deep(.hljs-literal) { color: #ff9e64; }
.markdown-body :deep(.hljs-punctuation) { color: #89ddff; }
.markdown-body :deep(.hljs-meta) { color: #565f89; }
.markdown-body :deep(.hljs-selector-tag) { color: #bb9af7; }
.markdown-body :deep(.hljs-selector-class) { color: #9ece6a; }
.markdown-body :deep(.hljs-selector-id) { color: #7aa2f7; }
.markdown-body :deep(.hljs-tag) { color: #f7768e; }
.markdown-body :deep(.hljs-name) { color: #f7768e; }
.markdown-body :deep(.hljs-attribute) { color: #bb9af7; }
</style>
