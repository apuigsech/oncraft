<script setup lang="ts">
import { toUIMessages, toChatStatus } from '~/services/message-adapter';
import type { ToolInvocationUIPart } from '~/services/message-adapter';
import { renderMarkdown, useDebouncedMarkdown } from '~/services/markdown';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import type { ImageAttachment } from '~/types';

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

const rawMessages = computed(() => {
  if (!sessionsStore.activeChatCardId) return [];
  return sessionsStore.getMessages(sessionsStore.activeChatCardId);
});

const isActive = computed(() => {
  if (!sessionsStore.activeChatCardId) return false;
  return sessionsStore.isActive(sessionsStore.activeChatCardId);
});

const metrics = computed(() => {
  if (!sessionsStore.activeChatCardId) return { inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: 0 };
  return sessionsStore.getSessionMetrics(sessionsStore.activeChatCardId);
});

const sessionConfig = computed(() => {
  if (!sessionsStore.activeChatCardId) return { model: 'sonnet' as const, effort: 'high' as const, permissionMode: 'default' as const };
  return sessionsStore.getSessionConfig(sessionsStore.activeChatCardId);
});

const progressEvents = computed(() => {
  if (!sessionsStore.activeChatCardId) return [];
  return sessionsStore.getProgressEvents(sessionsStore.activeChatCardId);
});

// Adapted messages for UChatMessages
const uiMessages = computed(() => toUIMessages(rawMessages.value));
const chatStatus = computed(() => toChatStatus(isActive.value, rawMessages.value));

// Find the original StreamMessage for a tool part (needed by ToolCallBlock)
function findToolStreamMessage(part: ToolInvocationUIPart) {
  return rawMessages.value.find(
    m => (m.type === 'tool_use' || m.type === 'tool_confirmation') && m.toolUseId === part.toolCallId
  ) || rawMessages.value.find(
    m => (m.type === 'tool_use' || m.type === 'tool_confirmation') && m.toolName === part.toolName
  );
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
const taskListEl = ref<InstanceType<typeof TaskListDisplay> | null>(null);

function onTaskListToggle() {
  const wrapper = messagesWrapper.value;
  const taskEl = (taskListEl.value as any)?.$el as HTMLElement | undefined;
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

// Scroll to bottom when the chat opens or the active card changes
const messagesWrapper = ref<HTMLElement | null>(null);

function scrollToBottom() {
  const el = messagesWrapper.value;
  if (el) el.scrollTop = el.scrollHeight;
}

watch(() => sessionsStore.activeChatCardId, () => {
  nextTick(scrollToBottom);
});

// Also scroll when messages are loaded (e.g. history arrives async after chat opens)
watch(() => rawMessages.value.length, (newLen, oldLen) => {
  if (oldLen === 0 && newLen > 0) {
    nextTick(scrollToBottom);
  }
});

onMounted(() => {
  nextTick(scrollToBottom);
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

    <!-- Task list — sticky, always visible above the scrollable messages -->
    <TaskListDisplay ref="taskListEl" :messages="rawMessages" class="task-list-sticky" @toggle="onTaskListToggle" />

    <!-- Messages area — UChatMessages handles scroll + auto-scroll -->
    <div ref="messagesWrapper" class="chat-messages-wrapper">
      <UChatMessages
        :messages="uiMessages"
        :status="chatStatus"
        :should-auto-scroll="true"
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
              <!-- QW-5: MarkdownContent debounces parsing during streaming -->
              <MarkdownContent
                v-if="role === 'assistant'"
                :text="part.text"
                :streaming="chatStatus === 'streaming'"
              />
              <div v-else-if="role === 'user'" class="user-text">{{ part.text }}</div>
              <div v-else class="system-text">{{ part.text }}</div>
            </template>

            <!-- Reasoning (thinking) -->
            <div v-else-if="part.type === 'reasoning'" class="thinking-block">
              <span class="thinking-label">Thinking...</span>
              <div class="thinking-content">{{ part.reasoning }}</div>
            </div>

            <!-- Tool invocations — delegate to our existing ToolCallBlock -->
            <template v-else-if="part.type === 'dynamic-tool'">
              <ToolCallBlock
                v-if="findToolStreamMessage(part)"
                :message="findToolStreamMessage(part)!"
                :card-id="sessionsStore.activeChatCardId!"
              />
              <!-- Fallback if no original message found -->
              <div v-else class="tool-fallback">
                <UIcon name="i-lucide-terminal" class="tool-fallback-icon" />
                <span>{{ part.toolName }}</span>
                <span v-if="part.state === 'output-available'" class="tool-done">done</span>
              </div>
            </template>
          </template>
        </template>
      </UChatMessages>

      <div v-if="!rawMessages.length" class="empty-chat">
        Start chatting to begin the session
      </div>
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
        <AgentProgressBar :events="progressEvents" :is-active="isActive" />
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
.chat-messages-wrapper { flex: 1; overflow-y: auto; display: flex; flex-direction: column; }
.chat-messages-inner { flex: 1; padding: 12px; }
.empty-chat { text-align: center; color: var(--text-muted); margin-top: 40%; font-size: 13px; }

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

/* Thinking block */
.thinking-block { opacity: 0.7; border-left: 2px solid var(--text-muted); padding-left: 10px; }
.thinking-label { font-size: 11px; font-weight: 600; color: var(--text-muted); display: block; margin-bottom: 4px; }
.thinking-content { font-size: 13px; line-height: 1.6; color: var(--text-secondary); }

/* Tool fallback */
.tool-fallback {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; color: var(--text-secondary);
  padding: 6px 10px; background: var(--bg-secondary);
  border-radius: 6px; border: 1px solid var(--bg-tertiary);
}
.tool-fallback-icon { width: 14px; height: 14px; }
.tool-done { font-size: 9px; color: var(--success); font-weight: 600; }

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
