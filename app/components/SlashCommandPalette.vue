<script setup lang="ts">

interface SlashCommand {
  name: string;
  desc: string;
  source?: string;
}

const props = defineProps<{
  filter: string;
  visible: boolean;
  commands: SlashCommand[];
}>();
const emit = defineEmits<{ select: [command: string] }>();

// Built-in commands always available
const BUILTIN: SlashCommand[] = [
  { name: '/clear', desc: 'Clear conversation and start fresh' },
  { name: '/compact', desc: 'Compact context to free space' },
  { name: '/context', desc: 'Show context window usage' },
  { name: '/cost', desc: 'Show session cost and usage' },
  { name: '/diff', desc: 'Show file changes this session' },
  { name: '/help', desc: 'Show available commands' },
  { name: '/model', desc: 'Switch AI model' },
  { name: '/plan', desc: 'Enter plan mode' },
];

const allCommands = computed(() => {
  const builtinNames = new Set(BUILTIN.map(c => c.name));
  const dynamic = (props.commands || [])
    .filter(c => !builtinNames.has(c.name))
    .map(c => ({ name: c.name, desc: c.desc, source: c.source }));
  return [...BUILTIN, ...dynamic];
});

const filtered = computed(() => {
  const f = props.filter.toLowerCase();
  return allCommands.value.filter(c => c.name.toLowerCase().includes(f));
});
</script>

<template>
  <div v-if="visible && filtered.length > 0" class="slash-palette">
    <div
      v-for="cmd in filtered" :key="cmd.name"
      class="slash-item"
      @mousedown.prevent="emit('select', cmd.name)"
    >
      <span class="slash-name">{{ cmd.name }}</span>
      <span class="slash-desc">{{ cmd.desc }}</span>
      <span v-if="cmd.source" class="slash-source">{{ cmd.source }}</span>
    </div>
  </div>
</template>

<style scoped>
.slash-palette {
  position: absolute; bottom: 100%; left: 0; right: 0;
  background: var(--bg-secondary); border: 1px solid var(--border);
  border-radius: 6px; margin-bottom: 4px; overflow: hidden;
  max-height: 300px; overflow-y: auto;
  box-shadow: 0 -4px 12px rgba(0,0,0,0.3);
  z-index: 50;
}
.slash-item {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px; cursor: pointer; transition: background 0.1s;
}
.slash-item:hover { background: var(--bg-tertiary); }
.slash-name {
  font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px;
  color: var(--accent); font-weight: 600; min-width: 120px; flex-shrink: 0;
}
.slash-desc { font-size: 11px; color: var(--text-secondary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.slash-source { font-size: 9px; color: var(--text-muted); background: var(--bg-tertiary); padding: 1px 5px; border-radius: 3px; flex-shrink: 0; }
</style>
