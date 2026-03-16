<script setup lang="ts">
defineProps<{
  x: number;
  y: number;
  cardId: string;
  archived: boolean;
}>();

const emit = defineEmits<{
  archive: [cardId: string];
  unarchive: [cardId: string];
  delete: [cardId: string];
  close: [];
}>();
</script>

<template>
  <Teleport to="body">
    <div class="menu-backdrop" @click="emit('close')" @contextmenu.prevent="emit('close')" />
    <div class="context-menu" :style="{ left: x + 'px', top: y + 'px' }">
      <button v-if="!archived" class="menu-item" @click="emit('archive', cardId)">
        <span class="menu-icon">📦</span> Archive
      </button>
      <button v-else class="menu-item" @click="emit('unarchive', cardId)">
        <span class="menu-icon">📤</span> Unarchive
      </button>
      <button class="menu-item danger" @click="emit('delete', cardId)">
        <span class="menu-icon">🗑️</span> Delete session
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.menu-backdrop { position: fixed; inset: 0; z-index: 200; }
.context-menu {
  position: fixed; z-index: 201;
  background: var(--bg-secondary); border: 1px solid var(--border);
  border-radius: 6px; padding: 4px; min-width: 160px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.4);
}
.menu-item {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 6px 10px; border-radius: 4px; font-size: 13px;
  color: var(--text-primary); text-align: left;
  transition: background 0.1s;
}
.menu-item:hover { background: var(--bg-tertiary); }
.menu-item.danger { color: var(--error); }
.menu-item.danger:hover { background: rgba(239,68,68,0.1); }
.menu-icon { font-size: 14px; }
</style>
