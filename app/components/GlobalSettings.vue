<script setup lang="ts">
import type { ChatMode } from '~/types';

const open = defineModel<boolean>('open', { default: true });

const emit = defineEmits<{ close: [] }>();
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

function close() {
  emit('close');
  open.value = false;
}
</script>

<template>
  <UModal v-model:open="open" title="Global Settings" :ui="{ width: 'sm:max-w-[460px]' }" @update:open="(val: boolean) => { if (!val) close() }">
    <template #body>
      <div class="flex flex-col gap-4">
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
        </div>

        <p class="info-msg">Claude agent is bundled with the application. Console mode requires the Claude CLI to be installed.</p>
      </div>
    </template>
  </UModal>
</template>

<style scoped>
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
