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
const answer = computed(() => props.part.data.answer as string | undefined);
const isResolved = computed(() => !!props.part.resolved);

// Track selected options per question (for multiSelect)
const selected = ref<Record<number, Set<string>>>({});
const freeformInput = ref('');

// Build updatedInput for the SDK: replicate the original toolInput with selected answers
function buildUpdatedInput(selectedLabels: string[]): Record<string, unknown> {
  const toolInput = (props.part.data.toolInput ?? {}) as Record<string, unknown>;
  const qs = questions.value;
  // Add the selected answer(s) to each question
  const updatedQuestions = qs.map((q, i) => ({
    ...q,
    // For single-select, use the first selected label; for multi, join them
    selectedOption: selectedLabels[i] ?? selectedLabels[0] ?? '',
  }));
  return {
    ...toolInput,
    questions: updatedQuestions,
  };
}

async function selectOption(label: string) {
  // AskUserQuestion comes through canUseTool as tool_confirmation.
  // Approve with updatedInput containing the user's selection
  const updatedInput = buildUpdatedInput([label]);
  await sessionsStore.approveToolUse(props.cardId, updatedInput);
  sessionsStore.resolveActionPart(props.cardId, props.part.id, label);
}

function toggleOption(qIndex: number, label: string) {
  if (!selected.value[qIndex]) selected.value[qIndex] = new Set();
  const set = selected.value[qIndex];
  if (set.has(label)) set.delete(label);
  else set.add(label);
}

async function submitMultiSelect(qIndex: number) {
  const set = selected.value[qIndex];
  if (!set || set.size === 0) return;
  const labels = Array.from(set);
  const answerText = labels.join(', ');
  const updatedInput = buildUpdatedInput(labels);
  await sessionsStore.approveToolUse(props.cardId, updatedInput);
  sessionsStore.resolveActionPart(props.cardId, props.part.id, answerText);
}

function isSelected(qIndex: number, label: string): boolean {
  return !!selected.value[qIndex]?.has(label);
}

async function submitFreeform() {
  const text = freeformInput.value.trim();
  if (!text) return;
  const updatedInput = buildUpdatedInput([text]);
  await sessionsStore.approveToolUse(props.cardId, updatedInput);
  sessionsStore.resolveActionPart(props.cardId, props.part.id, text);
  freeformInput.value = '';
}
</script>

<template>
  <!-- Resolved: compact inline display -->
  <div v-if="isResolved" class="question-resolved">
    <span class="resolved-icon">&#x2753;</span>
    <span class="resolved-question">{{ questions[0]?.question || 'Question' }}</span>
    <span class="resolved-arrow">&rarr;</span>
    <span class="resolved-answer">{{ answer }}</span>
  </div>

  <!-- Active: full interactive display -->
  <div v-else class="user-question-bar">
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
            @click="q.multiSelect ? toggleOption(qIndex, opt.label) : selectOption(opt.label)"
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

    <!-- Fallback if questions array is empty -->
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
/* ── Resolved (compact inline) ── */
.question-resolved {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: var(--bg-secondary);
  border: 1px solid var(--bg-tertiary);
  border-radius: 6px;
  font-size: 12px;
}
.resolved-icon { font-size: 13px; flex-shrink: 0; }
.resolved-question { color: var(--text-muted); flex-shrink: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.resolved-arrow { color: var(--text-muted); flex-shrink: 0; }
.resolved-answer { color: var(--accent); font-weight: 600; }

/* ── Active (interactive) ── */
.user-question-bar {
  border: 1px solid var(--accent);
  background: var(--bg-secondary);
  border-radius: 8px;
  padding: 12px 14px;
}

.question-block { margin-bottom: 10px; }
.question-block:last-child { margin-bottom: 0; }

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

.submit-multi { align-self: flex-end; margin-top: 4px; }

.question-freeform {
  display: flex;
  align-items: center;
  gap: 8px;
}

.freeform-input { flex: 1; }
</style>
