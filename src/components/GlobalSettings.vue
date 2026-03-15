<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useSettingsStore } from '../stores/settings';
import { useSessionsStore } from '../stores/sessions';

const emit = defineEmits<{ close: [] }>();
const settingsStore = useSettingsStore();
const sessionsStore = useSessionsStore();

const claudePath = ref(settingsStore.settings.claudeBinaryPath);
const binaryStatus = ref<'checking' | 'ok' | 'error'>('checking');

onMounted(async () => {
  const ok = await sessionsStore.verifyClaudeBinary();
  binaryStatus.value = ok ? 'ok' : 'error';
});

async function savePath() {
  await settingsStore.updateClaudePath(claudePath.value);
  const ok = await sessionsStore.verifyClaudeBinary();
  binaryStatus.value = ok ? 'ok' : 'error';
}
</script>

<template>
  <div class="dialog-overlay" @click.self="emit('close')">
    <div class="dialog">
      <div class="dialog-header">
        <h3>Global Settings</h3>
        <button class="close-btn" @click="emit('close')">x</button>
      </div>
      <div class="dialog-body">
        <label>
          Claude Binary Path
          <div class="input-row">
            <input v-model="claudePath" placeholder="claude" @blur="savePath" @keydown.enter="savePath" />
            <span class="status-badge" :class="binaryStatus">
              {{ binaryStatus === 'ok' ? 'Found' : binaryStatus === 'error' ? 'Not found' : '...' }}
            </span>
          </div>
        </label>
        <p v-if="binaryStatus === 'error'" class="error-msg">
          Claude Code not found at this path. Install Claude Code or provide the full path to the binary.
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; }
.dialog { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; width: 420px; }
.dialog-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--border); }
.dialog-header h3 { font-size: 16px; }
.close-btn { font-size: 16px; color: var(--text-muted); padding: 2px 6px; border-radius: 4px; }
.close-btn:hover { background: var(--bg-tertiary); }
.dialog-body { padding: 18px; display: flex; flex-direction: column; gap: 12px; }
label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-secondary); }
.input-row { display: flex; gap: 8px; align-items: center; }
input { flex: 1; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 4px; padding: 8px; font-size: 13px; }
input:focus { outline: none; border-color: var(--accent); }
.status-badge { font-size: 11px; padding: 2px 8px; border-radius: 3px; }
.status-badge.ok { background: rgba(34,197,94,0.2); color: var(--success); }
.status-badge.error { background: rgba(239,68,68,0.2); color: var(--error); }
.status-badge.checking { color: var(--text-muted); }
.error-msg { font-size: 12px; color: var(--error); }
</style>
