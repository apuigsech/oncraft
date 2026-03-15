<script setup lang="ts">
import { ref } from 'vue';
import type { StreamMessage } from '../types';
import { useSessionsStore } from '../stores/sessions';

const props = defineProps<{ message: StreamMessage; cardId: string }>();
const expanded = ref(false);
const sessionsStore = useSessionsStore();

async function approve() { await sessionsStore.approveToolUse(props.cardId); }
async function reject() { await sessionsStore.rejectToolUse(props.cardId); }
</script>
<template>
  <div class="tool-block" @click="expanded = !expanded">
    <div class="tool-header">
      <span class="tool-icon">{{ expanded ? '\u25BC' : '\u25B6' }}</span>
      <span class="tool-name">{{ message.toolName }}</span>
      <span v-if="message.type === 'tool_result'" class="tool-badge">result</span>
      <span v-if="message.type === 'tool_confirmation'" class="tool-badge confirm">approval needed</span>
    </div>
    <div v-if="message.type === 'tool_confirmation'" class="tool-confirm">
      <p class="confirm-msg">{{ message.content }}</p>
      <div class="confirm-actions">
        <button class="btn-approve" @click.stop="approve">Approve</button>
        <button class="btn-reject" @click.stop="reject">Reject</button>
      </div>
    </div>
    <div v-if="expanded" class="tool-detail">
      <pre v-if="message.toolInput">{{ JSON.stringify(message.toolInput, null, 2) }}</pre>
      <pre v-if="message.toolResult" class="tool-result">{{ message.toolResult }}</pre>
    </div>
  </div>
</template>
<style scoped>
.tool-block { background: var(--bg-secondary); border: 1px solid var(--bg-tertiary); border-radius: 4px; padding: 6px 10px; cursor: pointer; font-size: 12px; }
.tool-header { display: flex; align-items: center; gap: 6px; }
.tool-icon { font-size: 10px; color: var(--text-muted); }
.tool-name { color: var(--warning); font-family: monospace; }
.tool-badge { font-size: 10px; background: var(--bg-tertiary); padding: 1px 6px; border-radius: 3px; color: var(--text-secondary); }
.tool-confirm { padding: 8px 0; }
.confirm-msg { font-size: 12px; color: var(--text-secondary); margin-bottom: 8px; }
.confirm-actions { display: flex; gap: 8px; }
.btn-approve { background: var(--success); color: white; padding: 4px 12px; border-radius: 4px; font-size: 12px; }
.btn-reject { background: var(--error); color: white; padding: 4px 12px; border-radius: 4px; font-size: 12px; }
.tool-badge.confirm { background: var(--warning); color: #000; }
.tool-detail { margin-top: 8px; }
pre { font-size: 11px; color: var(--text-secondary); white-space: pre-wrap; word-break: break-all; max-height: 200px; overflow-y: auto; }
.tool-result { margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--bg-tertiary); }
</style>
