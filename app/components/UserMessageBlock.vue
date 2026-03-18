<script setup lang="ts">
import type { ChatPart } from '~/types';

defineProps<{
  part: ChatPart;
  cardId: string;
}>();
</script>

<template>
  <div class="user-message-block">
    <div v-if="part.data.content" class="user-text">{{ part.data.content }}</div>
    <div v-if="part.data.images && Array.isArray(part.data.images)" class="user-images">
      <img
        v-for="(img, idx) in (part.data.images as Array<{ mediaType: string; data: string }>)"
        :key="idx"
        :src="`data:${img.mediaType};base64,${img.data}`"
        class="user-image"
        loading="lazy"
      />
    </div>
  </div>
</template>

<style scoped>
.user-message-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.user-text {
  white-space: pre-wrap;
  font-size: 13px;
  line-height: 1.6;
  word-break: break-word;
  color: var(--text-primary);
}

.user-images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.user-image {
  max-width: 300px;
  max-height: 300px;
  border-radius: 8px;
  object-fit: contain;
}
</style>
