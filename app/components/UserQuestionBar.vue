<script setup lang="ts">
import type { ChatPart } from '~/types';

const props = defineProps<{ part: ChatPart; cardId: string }>();
const sessionsStore = useSessionsStore();

const question = computed(() => (props.part.data.question as string) || '');
const options = computed(() => (props.part.data.options as string[]) || []);

const freeformInput = ref('');

function selectOption(option: string) {
  sessionsStore.send(props.cardId, option);
  sessionsStore.resolveActionPart(props.cardId, props.part.id);
}

function submitFreeform() {
  const text = freeformInput.value.trim();
  if (!text) return;
  sessionsStore.send(props.cardId, text);
  sessionsStore.resolveActionPart(props.cardId, props.part.id);
  freeformInput.value = '';
}
</script>

<template>
  <div class="user-question-bar">
    <div class="question-text">{{ question }}</div>

    <!-- Options buttons -->
    <div v-if="options.length > 0" class="question-options">
      <UButton
        v-for="option in options"
        :key="option"
        variant="outline"
        size="sm"
        class="question-option-btn"
        @click="selectOption(option)"
      >
        {{ option }}
      </UButton>
    </div>

    <!-- Freeform input when no options provided -->
    <div v-else class="question-freeform">
      <UInput
        v-model="freeformInput"
        placeholder="Type your answer..."
        size="sm"
        class="freeform-input"
        @keydown.enter="submitFreeform"
      />
      <UButton size="sm" @click="submitFreeform">Submit</UButton>
    </div>
  </div>
</template>

<style scoped>
.user-question-bar {
  border: 1px solid var(--accent);
  background: var(--bg-secondary);
  border-radius: 8px;
  padding: 12px 14px;
}

.question-text {
  font-size: 13px;
  line-height: 1.5;
  margin-bottom: 10px;
}

.question-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.question-option-btn:hover {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.question-freeform {
  display: flex;
  align-items: center;
  gap: 8px;
}

.freeform-input {
  flex: 1;
}
</style>
