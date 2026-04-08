<script setup lang="ts">
import type { ChatPart } from '~/types';

const props = defineProps<{ part: ChatPart; cardId: string }>();

const expanded = ref(false);

const hookName = computed(() => (props.part.data.hookName as string) || '');
const hookEvent = computed(() => (props.part.data.hookEvent as string) || '');
const outcome = computed(() => (props.part.data.outcome as string) || '');
const output = computed(() => (props.part.data.output as string) || '');
const stdout = computed(() => (props.part.data.stdout as string) || '');
const stderr = computed(() => (props.part.data.stderr as string) || '');

const hasDetails = computed(() => !!output.value || !!stdout.value || !!stderr.value);
</script>

<template>
  <UCollapsible v-model:open="expanded" class="hook-activity-block" :disabled="!hasDetails" :unmount-on-hide="false">
    <UButton
      variant="ghost"
      color="neutral"
      block
      class="hook-header"
      :trailing-icon="hasDetails ? 'i-lucide-chevron-down' : undefined"
      :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
    >
      <UIcon name="i-lucide-settings" class="hook-icon" />
      <span class="hook-name">{{ hookName }}</span>
      <span class="hook-event">{{ hookEvent }}</span>
      <div class="hook-spacer" />
      <UBadge
        v-if="part.kind === 'hook_started'"
        color="primary"
        variant="subtle"
        size="xs"
      >
        running
      </UBadge>
      <UBadge
        v-else-if="part.kind === 'hook_response' && outcome === 'success'"
        color="success"
        variant="subtle"
        size="xs"
      >
        success
      </UBadge>
      <UBadge
        v-else-if="part.kind === 'hook_response' && outcome === 'error'"
        color="error"
        variant="subtle"
        size="xs"
      >
        error
      </UBadge>
      <UBadge
        v-else-if="part.kind === 'hook_progress'"
        color="primary"
        variant="subtle"
        size="xs"
      >
        running
      </UBadge>
    </UButton>

    <template #content>
      <div v-if="hasDetails" class="hook-details">
        <div v-if="output" class="hook-detail-section">
          <span class="hook-detail-label">output:</span>
          <pre class="hook-detail-content">{{ output }}</pre>
        </div>
        <div v-if="stdout" class="hook-detail-section">
          <span class="hook-detail-label">stdout:</span>
          <pre class="hook-detail-content">{{ stdout }}</pre>
        </div>
        <div v-if="stderr" class="hook-detail-section">
          <span class="hook-detail-label">stderr:</span>
          <pre class="hook-detail-content">{{ stderr }}</pre>
        </div>
      </div>
    </template>
  </UCollapsible>
</template>

<style scoped>
.hook-activity-block {
  background: var(--bg-secondary);
  border: 1px solid var(--bg-tertiary);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 11px;
}

.hook-header {
  justify-content: flex-start !important;
  padding-inline: 0 !important;
}

.hook-icon {
  font-size: 14px;
  flex-shrink: 0;
  color: var(--text-muted);
}

.hook-name {
  font-weight: 700;
  font-size: 11px;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.hook-event {
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 10px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.hook-spacer {
  flex: 1;
}

.hook-details {
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--bg-tertiary);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.hook-detail-section {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.hook-detail-label {
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 10px;
  color: var(--text-muted);
}

.hook-detail-content {
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--bg-tertiary);
  border-radius: 4px;
  padding: 4px 6px;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow-y: auto;
}
</style>
