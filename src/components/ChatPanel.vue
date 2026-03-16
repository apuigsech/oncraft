<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { useSessionsStore } from '../stores/sessions';
import { useCardsStore } from '../stores/cards';
import ChatMessage from './ChatMessage.vue';
import ToolCallBlock from './ToolCallBlock.vue';
import InputToolbar from './InputToolbar.vue';
import ContextGauge from './ContextGauge.vue';
import SessionMetrics from './SessionMetrics.vue';
import SlashCommandPalette from './SlashCommandPalette.vue';
import TaskListDisplay from './TaskListDisplay.vue';
import AgentProgressBar from './AgentProgressBar.vue';

const sessionsStore = useSessionsStore();
const cardsStore = useCardsStore();
const input = ref('');
const messagesContainer = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLTextAreaElement | null>(null); // native textarea ref

const showSlashPalette = computed(() => {
  const show = input.value.startsWith('/') && !input.value.includes(' ');
  if (show) console.log('[ClaudBan] slash palette visible, filter:', input.value, 'commands:', sessionsStore.availableCommands.length);
  return show;
});

const card = computed(() => {
  if (!sessionsStore.activeChatCardId) return null;
  return cardsStore.cards.find(c => c.id === sessionsStore.activeChatCardId) || null;
});

const messages = computed(() => {
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

// Auto-scroll when new messages arrive
watch(
  () => messages.value.length,
  async () => {
    await nextTick();
    if (messagesContainer.value) messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
);

// Auto-scroll during streaming (last message grows without length change)
watch(
  () => {
    const msgs = messages.value;
    if (!msgs.length) return 0;
    return msgs[msgs.length - 1]?.content?.length ?? 0;
  },
  async () => {
    await nextTick();
    if (messagesContainer.value) messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
);

function sendMessage() {
  if (!input.value.trim() || !sessionsStore.activeChatCardId) return;
  const cardId = sessionsStore.activeChatCardId;
  const msg = input.value.trim();
  input.value = '';
  resetTextareaHeight();
  sessionsStore.send(cardId, msg);
}

function selectSlashCommand(command: string) {
  input.value = command + ' ';
  nextTick(() => inputRef.value?.focus());
}

function handleInterrupt() {
  if (sessionsStore.activeChatCardId) {
    sessionsStore.interruptSession(sessionsStore.activeChatCardId);
  }
}

function onInput() { autoGrowTextarea(); }

function autoGrowTextarea() {
  nextTick(() => {
    if (inputRef.value) {
      inputRef.value.style.height = 'auto';
      inputRef.value.style.height = Math.min(inputRef.value.scrollHeight, 150) + 'px';
    }
  });
}

function resetTextareaHeight() {
  nextTick(() => {
    if (inputRef.value) inputRef.value.style.height = 'auto';
  });
}
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

    <!-- Messages -->
    <div ref="messagesContainer" class="chat-messages">
      <TaskListDisplay :messages="messages" />
      <template v-for="(msg, i) in messages" :key="i">
        <ToolCallBlock
          v-if="msg.type === 'tool_use' || msg.type === 'tool_confirmation'"
          :message="msg" :card-id="sessionsStore.activeChatCardId!"
        />
        <ChatMessage v-else :message="msg" />
      </template>
      <div v-if="!messages.length" class="empty-chat">Start chatting to begin the session</div>
    </div>

    <!-- Input area -->
    <div class="chat-input-area">
      <InputToolbar
        v-if="card"
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
      <div class="progress-area">
        <AgentProgressBar :events="progressEvents" :is-active="isActive" />
      </div>
      <div class="input-wrapper">
        <SlashCommandPalette
          :filter="input"
          :visible="showSlashPalette"
          :commands="sessionsStore.availableCommands"
          @select="selectSlashCommand"
        />
      </div>
      <div class="input-row">
        <textarea
          ref="inputRef"
          v-model="input"
          :placeholder="isActive ? 'Claude is working...' : 'Message Claude... (Shift+Enter for new line)'"
          rows="1"
          :disabled="isActive"
          @keydown.enter.exact.prevent="sendMessage"
          @input="onInput"
          class="chat-textarea"
        />
        <UButton
          v-if="isActive"
          color="error"
          variant="soft"
          size="sm"
          icon="i-lucide-square"
          class="send-btn"
          @click="handleInterrupt"
        />
        <UButton
          v-else
          color="primary"
          variant="soft"
          size="sm"
          icon="i-lucide-arrow-up"
          :disabled="!input.trim()"
          class="send-btn"
          @click="sendMessage"
        />
      </div>
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
.chat-messages { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.empty-chat { text-align: center; color: var(--text-muted); margin-top: 40%; font-size: 13px; }
.chat-input-area { padding: 10px; border-top: 1px solid var(--border); }
.progress-area { min-height: 0; }
.input-wrapper { position: relative; }
.input-row { display: flex; gap: 8px; align-items: flex-end; }
.chat-textarea {
  flex: 1;
  resize: none;
  overflow-y: auto;
  min-height: 36px;
  max-height: 150px;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-primary);
  transition: border-color 0.15s;
}
.chat-textarea:focus { outline: none; border-color: var(--accent); }
.chat-textarea:disabled { opacity: 0.5; cursor: not-allowed; }
.chat-textarea::placeholder { color: var(--text-muted); }
.send-btn { align-self: flex-end; flex-shrink: 0; }
</style>
