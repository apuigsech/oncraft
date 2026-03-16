<script setup lang="ts">
import type { ChatMode } from '~/types';

const emit = defineEmits<{ close: [] }>();
const settingsStore = useSettingsStore();

const chatModeOptions = [
  { label: 'Integrated UI', value: 'integrated', description: 'Rich chat with markdown, tool blocks, and metrics' },
  { label: 'Console (Terminal)', value: 'console', description: 'Full Claude CLI running in an embedded terminal' },
];

const selectedChatMode = computed({
  get: () => settingsStore.settings.chatMode || 'integrated',
  set: (val: ChatMode) => {
    settingsStore.settings.chatMode = val;
    settingsStore.save();
  },
});
</script>

<template>
  <div class="dialog-overlay" @click.self="emit('close')">
    <div class="dialog">
      <div class="dialog-header">
        <h3>Global Settings</h3>
        <button class="close-btn" @click="emit('close')">&times;</button>
      </div>
      <div class="dialog-body">
        <div class="setting-group">
          <label class="setting-label">Chat Mode</label>
          <div class="chat-mode-options">
            <button
              v-for="opt in chatModeOptions"
              :key="opt.value"
              class="mode-option"
              :class="{ active: selectedChatMode === opt.value }"
              @click="selectedChatMode = opt.value as ChatMode"
            >
              <div class="mode-option-header">
                <UIcon :name="opt.value === 'integrated' ? 'i-lucide-message-square' : 'i-lucide-terminal'" class="mode-icon" />
                <span class="mode-label">{{ opt.label }}</span>
              </div>
              <span class="mode-desc">{{ opt.description }}</span>
            </button>
          </div>
        </div>

        <p class="info-msg">Claude agent is bundled with the application. Console mode requires the Claude CLI to be installed.</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; }
.dialog { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; width: 460px; }
.dialog-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--border); }
.dialog-header h3 { font-size: 16px; }
.close-btn { font-size: 18px; color: var(--text-muted); padding: 2px 6px; border-radius: 4px; }
.close-btn:hover { background: var(--bg-tertiary); }
.dialog-body { padding: 18px; display: flex; flex-direction: column; gap: 16px; }
.info-msg { font-size: 12px; color: var(--text-muted); }

.setting-group { display: flex; flex-direction: column; gap: 8px; }
.setting-label { font-size: 13px; font-weight: 600; color: var(--text-primary); }

.chat-mode-options { display: flex; gap: 10px; }
.mode-option {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border: 2px solid var(--border);
  border-radius: 8px;
  background: var(--bg-primary);
  cursor: pointer;
  transition: all 0.15s;
  text-align: left;
}
.mode-option:hover { border-color: var(--text-muted); }
.mode-option.active { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--bg-primary)); }
.mode-option-header { display: flex; align-items: center; gap: 8px; }
.mode-icon { width: 18px; height: 18px; color: var(--text-secondary); }
.mode-option.active .mode-icon { color: var(--accent); }
.mode-label { font-size: 13px; font-weight: 600; }
.mode-desc { font-size: 11px; color: var(--text-muted); line-height: 1.4; }
</style>
