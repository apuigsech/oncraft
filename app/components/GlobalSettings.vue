<script setup lang="ts">
import type { ChatMode } from '~/types';

const settingsStore = useSettingsStore();

const chatModeOptions = [
  { label: 'Integrated UI', value: 'integrated', description: 'Rich chat with markdown, tool blocks, and metrics', icon: 'i-lucide-message-square' },
  { label: 'Console (Terminal)', value: 'console', description: 'Full Claude CLI running in an embedded terminal', icon: 'i-lucide-terminal' },
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
  <div class="settings-page">
    <div class="settings-header">
      <UIcon name="i-lucide-settings" class="settings-header-icon" />
      <h1 class="settings-title">Settings</h1>
    </div>

    <div class="settings-content">
      <div class="settings-section">
        <h2 class="section-title">General</h2>

        <div class="setting-group">
          <span class="setting-label">Chat Mode</span>
          <div class="chat-mode-options">
            <UButton
              v-for="opt in chatModeOptions"
              :key="opt.value"
              :variant="selectedChatMode === opt.value ? 'outline' : 'ghost'"
              :color="selectedChatMode === opt.value ? 'primary' : 'neutral'"
              class="mode-option"
              :class="{ active: selectedChatMode === opt.value }"
              @click="selectedChatMode = opt.value as ChatMode"
            >
              <template #leading>
                <UIcon :name="opt.icon" class="mode-icon" />
              </template>
              <div class="mode-content">
                <span class="mode-label">{{ opt.label }}</span>
                <span class="mode-desc">{{ opt.description }}</span>
              </div>
            </UButton>
          </div>
          <p class="info-msg">Claude agent is bundled with the application. Console mode requires the Claude CLI to be installed.</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  height: 100%;
  overflow-y: auto;
  padding: 32px 40px;
  max-width: 680px;
  margin: 0 auto;
}

.settings-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 32px;
}
.settings-header-icon { font-size: 24px; color: var(--text-secondary); }
.settings-title { font-size: 22px; font-weight: 700; color: var(--text-primary); margin: 0; }

.settings-content { display: flex; flex-direction: column; gap: 32px; }

.settings-section { display: flex; flex-direction: column; gap: 16px; }
.section-title { font-size: 15px; font-weight: 600; color: var(--text-primary); margin: 0; padding-bottom: 8px; border-bottom: 1px solid var(--border); }

.setting-group { display: flex; flex-direction: column; gap: 8px; }
.setting-label { font-size: 13px; font-weight: 600; color: var(--text-primary); }

.chat-mode-options { display: flex; gap: 10px; }
.mode-option {
  flex: 1;
  height: auto !important;
  padding: 12px !important;
  display: flex !important;
  flex-direction: column !important;
  align-items: flex-start !important;
  gap: 6px !important;
  text-align: left;
}
.mode-option.active { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--bg-primary)); }
.mode-icon { width: 18px; height: 18px; }
.mode-content { display: flex; flex-direction: column; gap: 4px; }
.mode-label { font-size: 13px; font-weight: 600; }
.mode-desc { font-size: 11px; color: var(--text-muted); line-height: 1.4; }
.info-msg { font-size: 12px; color: var(--text-muted); }
</style>
