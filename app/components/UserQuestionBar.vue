<script setup lang="ts">
import type { ChatPart } from '~/types';

interface QuestionOption {
  label: string;
  description?: string;
}

interface Question {
  question: string;
  header?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
}

const props = defineProps<{ part: ChatPart; cardId: string }>();
const sessionsStore = useSessionsStore();

const questions = computed(() => (props.part.data.questions as Question[]) || []);

// Track selected options per question (for multiSelect)
const selected = ref<Record<number, Set<string>>>({});

const freeformInput = ref('');

function toggleOption(qIndex: number, label: string, multiSelect: boolean) {
  if (!multiSelect) {
    // Single select — send immediately
    sessionsStore.send(props.cardId, label);
    sessionsStore.resolveActionPart(props.cardId, props.part.id);
    return;
  }
  // Multi-select — toggle in set
  if (!selected.value[qIndex]) selected.value[qIndex] = new Set();
  const set = selected.value[qIndex];
  if (set.has(label)) set.delete(label);
  else set.add(label);
}

function submitMultiSelect(qIndex: number) {
  const set = selected.value[qIndex];
  if (!set || set.size === 0) return;
  sessionsStore.send(props.cardId, Array.from(set).join(', '));
  sessionsStore.resolveActionPart(props.cardId, props.part.id);
}

function isSelected(qIndex: number, label: string): boolean {
  return !!selected.value[qIndex]?.has(label);
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
    <template v-for="(q, qIndex) in questions" :key="qIndex">
      <div class="question-block">
        <div class="question-text">{{ q.question }}</div>

        <!-- Options as buttons -->
        <div v-if="q.options && q.options.length > 0" class="question-options">
          <button
            v-for="opt in q.options"
            :key="opt.label"
            class="option-btn"
            :class="{ selected: isSelected(qIndex, opt.label) }"
            @click="toggleOption(qIndex, opt.label, !!q.multiSelect)"
          >
            <span class="option-label">{{ opt.label }}</span>
            <span v-if="opt.description" class="option-desc">{{ opt.description }}</span>
          </button>

          <!-- Submit button for multiSelect -->
          <UButton
            v-if="q.multiSelect"
            size="sm"
            class="submit-multi"
            :disabled="!selected[qIndex]?.size"
            @click="submitMultiSelect(qIndex)"
          >
            Confirm
          </UButton>
        </div>

        <!-- Freeform input if no options -->
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

    <!-- Fallback if questions array is empty (shouldn't happen but just in case) -->
    <div v-if="questions.length === 0" class="question-freeform">
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

.question-block {
  margin-bottom: 10px;
}
.question-block:last-child {
  margin-bottom: 0;
}

.question-text {
  font-size: 13px;
  line-height: 1.5;
  margin-bottom: 10px;
  color: var(--text-primary, #e0e0e8);
}

.question-options {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.option-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--bg-tertiary);
  background: var(--bg-primary, #1a1b2e);
  cursor: pointer;
  transition: all 0.15s;
  text-align: left;
  width: 100%;
}
.option-btn:hover {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}
.option-btn.selected {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 15%, transparent);
}

.option-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #e0e0e8);
}

.option-desc {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}

.submit-multi {
  align-self: flex-end;
  margin-top: 4px;
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
