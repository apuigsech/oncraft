<script setup lang="ts">
import type { StreamMessage } from '../types';
defineProps<{ message: StreamMessage }>();
</script>
<template>
  <div class="chat-message" :class="message.type">
    <div v-if="message.type === 'assistant'" class="msg-bubble assistant">
      <span class="msg-role">Claude</span>
      <div class="msg-content">{{ message.content }}</div>
    </div>
    <div v-else-if="message.type === 'user'" class="msg-bubble user">
      <span class="msg-role">You</span>
      <div class="msg-content">{{ message.content }}</div>
    </div>
    <div v-else-if="message.type === 'system'" class="msg-system">{{ message.content }}</div>
  </div>
</template>
<style scoped>
.msg-bubble { padding: 8px 12px; border-radius: 6px; max-width: 90%; }
.msg-bubble.assistant { background: var(--bg-secondary); align-self: flex-start; }
.msg-bubble.user { background: var(--accent); color: white; align-self: flex-end; margin-left: auto; }
.msg-role { font-size: 11px; font-weight: 600; color: var(--text-muted); margin-bottom: 2px; display: block; }
.user .msg-role { color: rgba(255,255,255,0.7); }
.msg-content { font-size: 13px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
.msg-system { font-size: 11px; color: var(--text-muted); text-align: center; padding: 4px; font-style: italic; }
</style>
