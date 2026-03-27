<script setup lang="ts">
import type { UpdateInfo } from '~/services/version-check'

const props = defineProps<{ updateInfo: UpdateInfo }>()
defineEmits<{ dismiss: [] }>()

const truncatedChangelog = computed(() => {
  const lines = props.updateInfo.changelog.split('\n').filter(Boolean)
  const preview = lines.slice(0, 3).join(' ')
  return preview.length > 140 ? preview.slice(0, 140) + '...' : preview
})

async function openRelease() {
  const { open } = await import('@tauri-apps/plugin-opener')
  open(props.updateInfo.htmlUrl)
}
</script>

<template>
  <div class="update-notice">
    <div class="update-content">
      <UIcon name="i-lucide-download" class="update-icon" />
      <span class="update-text">
        <strong>OnCraft v{{ updateInfo.latestVersion }}</strong> is available
        <span v-if="truncatedChangelog" class="update-changelog"> — {{ truncatedChangelog }}</span>
      </span>
    </div>
    <div class="update-actions">
      <UButton size="xs" variant="soft" color="primary" @click="openRelease">
        View release
      </UButton>
      <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-x" @click="$emit('dismiss')" />
    </div>
  </div>
</template>

<style scoped>
.update-notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 12px;
  background: color-mix(in srgb, var(--accent) 15%, var(--bg-secondary));
  border-bottom: 1px solid var(--border);
  animation: slide-down 0.25s ease-out;
}

.update-content {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.update-icon {
  flex-shrink: 0;
  color: var(--accent);
  font-size: 16px;
}

.update-text {
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.update-changelog {
  color: var(--text-muted);
}

.update-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

@keyframes slide-down {
  from { transform: translateY(-100%); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
</style>
