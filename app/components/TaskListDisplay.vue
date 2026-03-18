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

const emit = defineEmits<{ 'toggle': [] }>();

const collapsed = ref(false);
function toggleCollapse() {
  collapsed.value = !collapsed.value;
  emit('toggle');
}
</script>

<template>
  <div v-if="tasks.length > 0" class="task-list">
    <div class="task-header" @click="toggleCollapse">
      <div class="task-header-left">
        <span class="task-chevron" :class="{ collapsed }">▸</span>
        <span class="task-title">Tasks</span>
      </div>
      <span class="task-count">{{ completedCount }}/{{ totalCount }}</span>
    </div>
    <div class="task-progress">
      <div class="progress-bar" :style="{ width: totalCount ? (completedCount / totalCount * 100) + '%' : '0%' }" />
    </div>
    <div v-show="!collapsed" class="task-items">
      <div v-for="(task, i) in tasks" :key="i" class="task-item" :class="task.status">
        <span class="task-icon">{{ statusIcon[task.status] }}</span>
        <span class="task-content">{{ task.content }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.task-list {
  background: var(--bg-secondary);
  padding: 8px 12px; font-size: 12px;
}
.task-header {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 6px; cursor: pointer; user-select: none;
  border-radius: 4px; padding: 2px 0;
}
.task-header:hover { opacity: 0.8; }
.task-header-left { display: flex; align-items: center; gap: 4px; }
.task-chevron {
  font-size: 10px; color: var(--text-muted);
  transition: transform 0.2s ease;
  transform: rotate(90deg);
  display: inline-block;
}
.task-chevron.collapsed { transform: rotate(0deg); }
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
