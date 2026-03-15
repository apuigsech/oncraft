<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ filter: string; visible: boolean }>();
const emit = defineEmits<{ select: [command: string] }>();

const SLASH_COMMANDS = [
  { name: '/clear', desc: 'Clear conversation and start fresh' },
  { name: '/compact', desc: 'Compact context to free space' },
  { name: '/context', desc: 'Show context window usage' },
  { name: '/cost', desc: 'Show session cost and usage' },
  { name: '/diff', desc: 'Show file changes this session' },
  { name: '/export', desc: 'Export conversation to file' },
  { name: '/fork', desc: 'Fork session into a new branch' },
  { name: '/help', desc: 'Show available commands' },
  { name: '/model', desc: 'Switch AI model' },
  { name: '/permissions', desc: 'View and manage permissions' },
  { name: '/plan', desc: 'Enter plan mode' },
  { name: '/resume', desc: 'Resume a previous session' },
  { name: '/rewind', desc: 'Rewind to a previous point' },
  { name: '/stats', desc: 'Show daily usage statistics' },
];

const filtered = computed(() =>
  SLASH_COMMANDS.filter(c => c.name.startsWith(props.filter.toLowerCase()))
);

const selectedIndex = computed(() => 0);
</script>

<template>
  <div v-if="visible && filtered.length > 0" class="slash-palette">
    <div
      v-for="(cmd, i) in filtered" :key="cmd.name"
      class="slash-item" :class="{ selected: i === selectedIndex }"
      @mousedown.prevent="emit('select', cmd.name)"
    >
      <span class="slash-name">{{ cmd.name }}</span>
      <span class="slash-desc">{{ cmd.desc }}</span>
    </div>
  </div>
</template>

<style scoped>
.slash-palette {
  position: absolute; bottom: 100%; left: 0; right: 0;
  background: var(--bg-secondary); border: 1px solid var(--border);
  border-radius: 6px; margin-bottom: 4px; overflow: hidden;
  max-height: 200px; overflow-y: auto;
  box-shadow: 0 -4px 12px rgba(0,0,0,0.3);
  z-index: 50;
}
.slash-item {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px; cursor: pointer; transition: background 0.1s;
}
.slash-item:hover, .slash-item.selected { background: var(--bg-tertiary); }
.slash-name {
  font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px;
  color: var(--accent); font-weight: 600; min-width: 100px;
}
.slash-desc { font-size: 11px; color: var(--text-muted); }
</style>
