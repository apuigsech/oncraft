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

const sessionsStore = useSessionsStore();
const cardsStore = useCardsStore();
const input = ref('');
const messagesContainer = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLTextAreaElement | null>(null);
const showSlashPalette = computed(() => input.value.startsWith('/') && !input.value.includes(' '));

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

watch(messages, async () => {
  await nextTick();
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
}, { deep: true });

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

function onInput() {
  autoGrowTextarea();
}

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
    if (inputRef.value) {
      inputRef.value.style.height = 'auto';
    }
  });
}
</script>

<template>
  <div class="chat-panel">
    <div class="chat-header">
      <div class="chat-title">
        <strong>{{ card?.name || 'Session' }}</strong>
        <span class="chat-phase">{{ card?.columnName }}</span>
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
      <button class="close-btn" @click="sessionsStore.closeChat()">x</button>
    </div>
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
    <div class="chat-input-area">
      <InputToolbar
        v-if="card"
        :model="sessionConfig.model"
        :effort="sessionConfig.effort"
        :permission-mode="sessionConfig.permissionMode"
        :git-branch="sessionConfig.gitBranch"
        @update:model="v => card && sessionsStore.updateSessionConfig(card.id, { model: v })"
        @update:effort="v => card && sessionsStore.updateSessionConfig(card.id, { effort: v })"
        @update:permission-mode="v => card && sessionsStore.updateSessionConfig(card.id, { permissionMode: v })"
      />
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
        />
        <button v-if="isActive" class="stop-btn" @click="handleInterrupt" title="Stop generation">
          Stop
        </button>
        <button v-else class="send-btn" :disabled="!input.trim()" @click="sendMessage">
          Send
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-panel {
  min-width: 320px; max-width: 600px;
  border-left: 1px solid var(--border); background: var(--bg-primary);
  display: flex; flex-direction: column;
}
.chat-header { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-bottom: 1px solid var(--border); background: var(--bg-secondary); }
.chat-title { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.chat-phase { font-size: 11px; color: var(--text-muted); background: var(--bg-tertiary); padding: 2px 8px; border-radius: 3px; }
.header-metrics { display: flex; align-items: center; gap: 10px; margin-left: auto; margin-right: 10px; }
.close-btn { font-size: 16px; color: var(--text-muted); padding: 2px 6px; border-radius: 4px; }
.close-btn:hover { background: var(--bg-tertiary); }
.chat-messages { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.empty-chat { text-align: center; color: var(--text-muted); margin-top: 40%; font-size: 13px; }
.chat-input-area { padding: 10px; border-top: 1px solid var(--border); }
.input-wrapper { position: relative; }
.input-row { display: flex; gap: 8px; }
textarea {
  flex: 1; background: var(--bg-secondary); border: 1px solid var(--border);
  border-radius: 6px; padding: 8px; font-size: 13px; resize: none;
  min-height: 36px; max-height: 150px; overflow-y: auto;
  font-family: inherit; line-height: 1.4;
}
textarea:focus { outline: none; border-color: var(--accent); }
textarea:disabled { opacity: 0.6; cursor: not-allowed; }
.send-btn {
  background: var(--accent); color: white; padding: 8px 16px;
  border-radius: 6px; font-size: 13px; align-self: flex-end;
}
.send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.stop-btn {
  background: var(--error); color: white; padding: 8px 16px;
  border-radius: 6px; font-size: 13px; align-self: flex-end;
  font-weight: 600;
}
.stop-btn:hover { opacity: 0.9; }
</style>
