<script setup lang="ts">
import type { StreamMessage } from '~/types';

const props = defineProps<{ messages: StreamMessage[] }>();

interface TaskItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

// Extract tasks from TodoWrite tool calls in the message history
const tasks = computed<TaskItem[]>(() => {
  const items: TaskItem[] = [];
  for (const msg of props.messages) {
    if (msg.type === 'tool_use' && msg.toolName === 'TodoWrite') {
      const input = msg.toolInput as { todos?: Array<{ content: string; status: string }> } | undefined;
      if (input?.todos && Array.isArray(input.todos)) {
        // TodoWrite replaces all tasks, so clear and re-add
        items.length = 0;
        for (const todo of input.todos) {
          items.push({
            content: todo.content || '',
            status: (todo.status as TaskItem['status']) || 'pending',
          });
        }
      }
    }
  }
  return items;
});

const statusIcon: Record<string, string> = {
  pending: '○',
  in_progress: '◉',
  completed: '●',
};

const completedCount = computed(() => tasks.value.filter(t => t.status === 'completed').length);
const totalCount = computed(() => tasks.value.length);
</script>

<template>
  <div v-if="tasks.length > 0" class="task-list">
    <div class="task-header">
      <span class="task-title">Tasks</span>
      <span class="task-count">{{ completedCount }}/{{ totalCount }}</span>
    </div>
    <div class="task-progress">
      <div class="progress-bar" :style="{ width: totalCount ? (completedCount / totalCount * 100) + '%' : '0%' }" />
    </div>
    <div v-for="(task, i) in tasks" :key="i" class="task-item" :class="task.status">
      <span class="task-icon">{{ statusIcon[task.status] }}</span>
      <span class="task-content">{{ task.content }}</span>
    </div>
  </div>
</template>

<style scoped>
.task-list {
  background: var(--bg-secondary); border: 1px solid var(--bg-tertiary);
  border-radius: 6px; padding: 8px 10px; font-size: 12px;
}
.task-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.task-title { font-weight: 600; color: var(--text-secondary); }
.task-count { color: var(--text-muted); font-family: monospace; font-size: 11px; }
.task-progress {
  height: 3px; background: var(--bg-tertiary); border-radius: 2px;
  margin-bottom: 8px; overflow: hidden;
}
.progress-bar { height: 100%; background: var(--success); border-radius: 2px; transition: width 0.3s; }
.task-item { display: flex; align-items: flex-start; gap: 6px; padding: 2px 0; }
.task-icon { flex-shrink: 0; font-size: 10px; margin-top: 2px; }
.task-content { color: var(--text-secondary); line-height: 1.4; }
.task-item.completed .task-icon { color: var(--success); }
.task-item.completed .task-content { color: var(--text-muted); text-decoration: line-through; }
.task-item.in_progress .task-icon { color: var(--accent); }
.task-item.pending .task-icon { color: var(--text-muted); }
</style>
