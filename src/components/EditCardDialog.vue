<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{ name: string; description: string }>();
const emit = defineEmits<{ save: [name: string, description: string]; cancel: [] }>();

const editName = ref(props.name);
const editDesc = ref(props.description);

function save() {
  if (!editName.value.trim()) return;
  emit('save', editName.value.trim(), editDesc.value.trim());
}
</script>

<template>
  <UModal :model-value="true" @update:model-value="emit('cancel')" title="Edit Card" :ui="{ footer: 'justify-end' }">
    <template #body>
      <div class="flex flex-col gap-4">
        <UFormField label="Title">
          <UInput
            v-model="editName"
            autofocus
            placeholder="Card title"
            @keydown.enter="save"
          />
        </UFormField>
        <UFormField label="Description">
          <UTextarea
            v-model="editDesc"
            :rows="3"
            placeholder="Optional description..."
          />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <UButton variant="ghost" @click="emit('cancel')">Cancel</UButton>
      <UButton color="primary" :disabled="!editName.trim()" @click="save">Save</UButton>
    </template>
  </UModal>
</template>
