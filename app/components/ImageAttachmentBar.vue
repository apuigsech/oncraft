<script setup lang="ts">
import type { ImageAttachment } from '~/types';

defineProps<{
  attachments: ImageAttachment[];
}>();

const emit = defineEmits<{
  remove: [id: string];
}>();

function truncateName(name: string, max = 20): string {
  if (name.length <= max) return name;
  const ext = name.lastIndexOf('.');
  if (ext > 0 && name.length - ext <= 5) {
    const base = name.slice(0, ext);
    const extension = name.slice(ext);
    const available = max - extension.length - 1;
    return base.slice(0, available) + '\u2026' + extension;
  }
  return name.slice(0, max - 1) + '\u2026';
}
</script>

<template>
  <div v-if="attachments.length > 0" class="attachment-bar">
    <div v-for="att in attachments" :key="att.id" class="attachment-item">
      <img
        :src="`data:${att.mediaType};base64,${att.data}`"
        :alt="att.name"
        class="attachment-thumb"
      />
      <span class="attachment-name">{{ truncateName(att.name) }}</span>
      <UButton
        variant="ghost"
        color="neutral"
        size="2xs"
        icon="i-lucide-x"
        :padded="false"
        @click="emit('remove', att.id)"
      />
    </div>
  </div>
</template>

<style scoped>
.attachment-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px;
  background: var(--bg-secondary);
  border-radius: 6px;
  border: 1px solid var(--border);
}
.attachment-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  background: var(--bg-primary);
  border-radius: 6px;
  border: 1px solid var(--border);
}
.attachment-thumb {
  width: 48px;
  height: 48px;
  object-fit: cover;
  border-radius: 4px;
  flex-shrink: 0;
}
.attachment-name {
  font-size: 11px;
  color: var(--text-secondary);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
