<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { useSessionsStore } from '../stores/sessions';
import { useCardsStore } from '../stores/cards';
import ChatMessage from './ChatMessage.vue';
import ToolCallBlock from './ToolCallBlock.vue';

const sessionsStore = useSessionsStore();
const cardsStore = useCardsStore();
const input = ref('');
const messagesContainer = ref<HTMLElement | null>(null);

const card = computed(() => {
  if (!sessionsStore.activeChatCardId) return null;
  return cardsStore.cards.find(c => c.id === sessionsStore.activeChatCardId) || null;
});

const messages = computed(() => {
  if (!sessionsStore.activeChatCardId) return [];
  return sessionsStore.getMessages(sessionsStore.activeChatCardId);
});

watch(messages, async () => {
  await nextTick();
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
}, { deep: true });

async function sendMessage() {
  console.log('[ClaudBan] sendMessage called, input:', input.value, 'activeCardId:', sessionsStore.activeChatCardId);
  if (!input.value.trim() || !sessionsStore.activeChatCardId) {
    console.log('[ClaudBan] sendMessage aborted: empty input or no active card');
    return;
  }
  const cardId = sessionsStore.activeChatCardId;
  try {
    await sessionsStore.send(cardId, input.value.trim());
    input.value = '';
  } catch (err) {
    console.error('[ClaudBan] send error:', err);
  }
}
</script>

<template>
  <div class="chat-panel">
    <div class="chat-header">
      <div class="chat-title">
        <strong>{{ card?.name || 'Session' }}</strong>
        <span class="chat-phase">{{ card?.columnName }}</span>
      </div>
      <button class="close-btn" @click="sessionsStore.closeChat()">x</button>
    </div>
    <div ref="messagesContainer" class="chat-messages">
      <template v-for="(msg, i) in messages" :key="i">
        <ToolCallBlock
          v-if="msg.type === 'tool_use' || msg.type === 'tool_result' || msg.type === 'tool_confirmation'"
          :message="msg" :card-id="sessionsStore.activeChatCardId!"
        />
        <ChatMessage v-else :message="msg" />
      </template>
      <div v-if="!messages.length" class="empty-chat">Start chatting to begin the session</div>
    </div>
    <div class="chat-input-area">
      <textarea v-model="input" placeholder="Type a message..." rows="2"
        @keydown.enter.exact.prevent="sendMessage" />
      <button class="send-btn" :disabled="!input.trim()" @click="sendMessage">Send</button>
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
.close-btn { font-size: 16px; color: var(--text-muted); padding: 2px 6px; border-radius: 4px; }
.close-btn:hover { background: var(--bg-tertiary); }
.chat-messages { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.empty-chat { text-align: center; color: var(--text-muted); margin-top: 40%; font-size: 13px; }
.chat-input-area { padding: 10px; border-top: 1px solid var(--border); display: flex; gap: 8px; }
textarea { flex: 1; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 6px; padding: 8px; font-size: 13px; resize: none; }
textarea:focus { outline: none; border-color: var(--accent); }
.send-btn { background: var(--accent); color: white; padding: 8px 16px; border-radius: 6px; font-size: 13px; align-self: flex-end; }
.send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
