<script setup lang="ts">
/**
 * Error boundary component.
 * Wraps children and catches rendering errors, showing a fallback UI
 * with a retry button instead of a blank screen.
 */
const hasError = ref(false)
const errorMessage = ref('')

onErrorCaptured((err: Error) => {
  hasError.value = true
  errorMessage.value = err.message || 'An unexpected error occurred'
  console.error('[OnCraft] ErrorBoundary caught:', err)
  // Prevent the error from propagating further
  return false
})

function retry() {
  hasError.value = false
  errorMessage.value = ''
}
</script>

<template>
  <div v-if="hasError" class="error-boundary">
    <div class="error-boundary-content">
      <UIcon name="i-lucide-alert-triangle" class="error-icon" />
      <h3 class="error-title">Something went wrong</h3>
      <p class="error-message">{{ errorMessage }}</p>
      <UButton color="primary" variant="soft" @click="retry">
        <UIcon name="i-lucide-refresh-cw" />
        Try again
      </UButton>
    </div>
  </div>
  <slot v-else />
</template>

<style scoped>
.error-boundary {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 200px;
  padding: 24px;
}
.error-boundary-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
  max-width: 320px;
}
.error-icon {
  width: 32px;
  height: 32px;
  color: var(--error, #f87171);
}
.error-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}
.error-message {
  font-size: 13px;
  color: var(--text-muted);
  margin: 0;
  line-height: 1.5;
}
</style>
