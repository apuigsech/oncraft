<script setup lang="ts">
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <UModal :model-value="true" @update:model-value="emit('close')" title="Global Settings" :ui="{ footer: 'justify-end' }">
    <template #body>
      <UAlert
        icon="i-lucide-info"
        color="neutral"
        variant="soft"
        description="Claude agent is bundled with the application. No configuration needed."
      />
    </template>
    <template #footer>
      <UButton variant="ghost" @click="emit('close')">Close</UButton>
    </template>
  </UModal>
</template>
