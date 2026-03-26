<script setup lang="ts">
/**
 * Reusable empty state component.
 * Shows an icon, title, description, and optional CTA button.
 */
defineProps<{
  icon?: string
  title: string
  description?: string
  actionLabel?: string
  actionIcon?: string
}>()

const emit = defineEmits<{
  action: []
}>()
</script>

<template>
  <div class="empty-state">
    <UIcon v-if="icon" :name="icon" class="empty-state-icon" />
    <h3 class="empty-state-title">{{ title }}</h3>
    <p v-if="description" class="empty-state-description">{{ description }}</p>
    <UButton
      v-if="actionLabel"
      color="primary"
      variant="soft"
      size="sm"
      :icon="actionIcon"
      @click="emit('action')"
    >
      {{ actionLabel }}
    </UButton>
    <slot />
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 32px 24px;
  text-align: center;
  height: 100%;
  min-height: 120px;
}
.empty-state-icon {
  width: 36px;
  height: 36px;
  color: var(--text-muted);
  opacity: 0.6;
}
.empty-state-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary);
  margin: 0;
}
.empty-state-description {
  font-size: 12px;
  color: var(--text-muted);
  margin: 0;
  max-width: 240px;
  line-height: 1.5;
}
</style>
