<script setup lang="ts">
const props = defineProps<{
  x: number;
  y: number;
  cardId: string;
  archived: boolean;
}>();
void props; // used in template

const emit = defineEmits<{
  edit: [cardId: string];
  archive: [cardId: string];
  unarchive: [cardId: string];
  delete: [cardId: string];
  close: [];
}>();
</script>

<template>
  <Teleport to="body">
    <div class="ctx-backdrop" @click="emit('close')" @contextmenu.prevent="emit('close')" />
    <div class="ctx-menu" :style="{ left: x + 'px', top: y + 'px' }">
      <button class="ctx-item" @click="emit('edit', cardId)">
        <UIcon name="i-lucide-pencil" class="ctx-icon" />
        Edit
      </button>
      <div class="ctx-divider" />
      <button v-if="archived" class="ctx-item" @click="emit('unarchive', cardId)">
        <UIcon name="i-lucide-archive-restore" class="ctx-icon" />
        Unarchive
      </button>
      <button v-else class="ctx-item" @click="emit('archive', cardId)">
        <UIcon name="i-lucide-archive" class="ctx-icon" />
        Archive
      </button>
      <button class="ctx-item ctx-item--danger" @click="emit('delete', cardId)">
        <UIcon name="i-lucide-trash-2" class="ctx-icon" />
        Delete session
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.ctx-backdrop {
  position: fixed;
  inset: 0;
  z-index: 200;
}
.ctx-menu {
  position: fixed;
  z-index: 201;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 4px;
  min-width: 160px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 5px;
  font-size: 13px;
  color: var(--text-primary);
  text-align: left;
  transition: background 0.1s;
}
.ctx-item:hover { background: var(--bg-tertiary); }
.ctx-item--danger { color: var(--error); }
.ctx-item--danger:hover { background: color-mix(in srgb, var(--error) 15%, transparent); }
.ctx-divider { height: 1px; background: var(--border); margin: 3px 0; }
.ctx-icon { width: 14px; height: 14px; flex-shrink: 0; }
</style>
