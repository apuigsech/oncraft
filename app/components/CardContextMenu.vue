<script setup lang="ts">
const props = defineProps<{
  cardId: string;
  archived: boolean;
}>();

const open = defineModel<boolean>('open', { default: false });

const emit = defineEmits<{
  edit: [cardId: string];
  fork: [cardId: string];
  archive: [cardId: string];
  unarchive: [cardId: string];
  delete: [cardId: string];
}>();

const items = computed(() => {
  const base = [
    [{
      label: 'Edit',
      icon: 'i-lucide-pencil',
      onSelect: () => emit('edit', props.cardId),
    },
    {
      label: 'Fork',
      icon: 'i-lucide-git-branch',
      onSelect: () => emit('fork', props.cardId),
    }],
    [
      props.archived
        ? {
            label: 'Unarchive',
            icon: 'i-lucide-archive-restore',
            onSelect: () => emit('unarchive', props.cardId),
          }
        : {
            label: 'Archive',
            icon: 'i-lucide-archive',
            onSelect: () => emit('archive', props.cardId),
          },
      {
        label: 'Delete session',
        icon: 'i-lucide-trash-2',
        color: 'error' as const,
        onSelect: () => emit('delete', props.cardId),
      },
    ],
  ];
  return base;
});
</script>

<template>
  <UContextMenu :items="items" v-model:open="open">
    <slot />
  </UContextMenu>
</template>
