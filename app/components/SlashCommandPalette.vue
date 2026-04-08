<script setup lang="ts">
import type { CommandPaletteGroup } from '@nuxt/ui'

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

const groups = computed<CommandPaletteGroup[]>(() => [{
  id: 'slash-commands',
  label: 'Commands',
  items: filtered.value.map(cmd => ({
    label: cmd.name,
    suffix: cmd.source,
    icon: 'i-lucide-slash',
    onSelect: () => emit('select', cmd.name),
  })),
}]);
</script>

<template>
  <UCommandPalette
    v-if="visible && filtered.length > 0"
    class="slash-palette"
    placeholder="Filter commands..."
    :groups="groups"
    icon="i-lucide-terminal"
  />
</template>

<style scoped>
.slash-palette {
  position: absolute; bottom: 100%; left: 0; right: 0;
  background: var(--bg-secondary); border: 1px solid var(--border);
  border-radius: 6px; margin-bottom: 4px; overflow: hidden;
  max-height: 320px; overflow-y: auto;
  box-shadow: 0 -4px 12px rgba(0,0,0,0.3);
  z-index: 50;
}
</style>
