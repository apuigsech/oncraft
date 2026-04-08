<script setup lang="ts">
import type { ChatPart } from '~/types';

const props = defineProps<{ part: ChatPart; cardId: string }>();

interface TaskItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

const tasks = computed<TaskItem[]>(() => {
  const todos = props.part.data.todos as Array<{ content: string; status: string }> | undefined;
  if (!todos || !Array.isArray(todos)) return [];
  return todos.map(todo => ({
    content: todo.content || '',
    status: (todo.status as TaskItem['status']) || 'pending',
  }));
});

const statusIcon: Record<string, string> = {
  pending: '○',
  in_progress: '◉',
  completed: '●',
};

const completedCount = computed(() => tasks.value.filter(t => t.status === 'completed').length);
const totalCount = computed(() => tasks.value.length);
const progressValue = computed(() => totalCount.value ? Math.round((completedCount.value / totalCount.value) * 100) : 0);

const emit = defineEmits<{ 'toggle': [] }>();

const isOpen = ref(true);
watch(isOpen, () => {
  emit('toggle');
});
</script>

<template>
  <UCollapsible v-if="tasks.length > 0" v-model:open="isOpen" class="task-list" :unmount-on-hide="false">
    <UButton
      variant="ghost"
      color="neutral"
      block
      class="task-header"
      trailing-icon="i-lucide-chevron-down"
      :ui="{ trailingIcon: 'group-data-[state=closed]:-rotate-90 transition-transform duration-200' }"
    >
      <div class="task-header-left">
        <span class="task-title">Tasks</span>
      </div>
      <span class="task-count">{{ completedCount }}/{{ totalCount }}</span>
    </UButton>

    <template #content>
      <div class="task-content-wrap">
        <UProgress :model-value="progressValue" color="success" size="xs" />
        <div class="task-items">
          <div v-for="(task, i) in tasks" :key="i" class="task-item" :class="task.status">
            <span class="task-icon">{{ statusIcon[task.status] }}</span>
            <span class="task-content">{{ task.content }}</span>
          </div>
        </div>
      </div>
    </template>
  </UCollapsible>
</template>

<style scoped>
.task-list {
  background: var(--bg-secondary);
  padding: 8px 12px; font-size: 12px;
}
.task-header {
  justify-content: space-between !important;
  padding-inline: 0 !important;
  margin-bottom: 6px;
}
.task-header-left { display: flex; align-items: center; gap: 4px; }
.task-title { font-weight: 600; color: var(--text-secondary); }
.task-count { color: var(--text-muted); font-family: monospace; font-size: 11px; }
.task-content-wrap { display: flex; flex-direction: column; gap: 8px; }
.task-item { display: flex; align-items: flex-start; gap: 6px; padding: 2px 0; }
.task-icon { flex-shrink: 0; font-size: 10px; margin-top: 2px; }
.task-content { color: var(--text-secondary); line-height: 1.4; }
.task-item.completed .task-icon { color: var(--success); }
.task-item.completed .task-content { color: var(--text-muted); text-decoration: line-through; }
.task-item.in_progress .task-icon { color: var(--accent); }
.task-item.pending .task-icon { color: var(--text-muted); }
</style>
