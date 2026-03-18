<script setup lang="ts">
import type { ChatPart } from '~/types';

const props = defineProps<{ part: ChatPart; cardId: string }>();
const expanded = ref(false);

const TOOL_INFO: Record<string, { icon: string; label: string }> = {
  Bash: { icon: '⚡', label: 'Run' },
  Read: { icon: '📖', label: 'Read' },
  Write: { icon: '📝', label: 'Write' },
  Edit: { icon: '✏️', label: 'Edit' },
  Glob: { icon: '🔍', label: 'Find' },
  Grep: { icon: '🔎', label: 'Search' },
  WebFetch: { icon: '🌐', label: 'Fetch' },
  WebSearch: { icon: '🌐', label: 'Web search' },
  Agent: { icon: '🤖', label: 'Sub-agent' },
  AskUserQuestion: { icon: '❓', label: 'Question' },
  Skill: { icon: '🧩', label: 'Skill' },
  NotebookEdit: { icon: '📓', label: 'Notebook' },
  Task: { icon: '📋', label: 'Task' },
  TodoWrite: { icon: '✅', label: 'Tasks' },
};

const toolName = computed(() => (props.part.data.toolName as string) || '');
const toolInput = computed(() => (props.part.data.toolInput as Record<string, unknown>) || {});
const toolResult = computed(() => props.part.data.toolResult as string | undefined);

const toolInfo = computed(() => TOOL_INFO[toolName.value] || { icon: '🔧', label: toolName.value || 'Tool' });

const summary = computed(() => {
  const input = toolInput.value;
  const name = toolName.value;
  switch (name) {
    case 'Bash': return `$ ${(input.command as string || '').substring(0, 80)}`;
    case 'Read': return `${input.file_path}`;
    case 'Write': return `${input.file_path}`;
    case 'Edit': return `${input.file_path}`;
    case 'Glob': return `${input.pattern}`;
    case 'Grep': return `"${input.pattern}" in ${input.path || '.'}`;
    case 'WebFetch': return `${(input.url as string || '').substring(0, 60)}`;
    case 'WebSearch': return `${input.query || ''}`;
    case 'Agent': return `${input.description || (input.prompt as string || '').substring(0, 50)}`;
    case 'Skill': return `${input.skill || ''}`;
    case 'TodoWrite': return 'Update task list';
    default: return name;
  }
});

const isEdit = computed(() => toolName.value === 'Edit');
const isBash = computed(() => toolName.value === 'Bash');
</script>

<template>
  <div class="tool-block">
    <div class="tool-header" @click="expanded = !expanded">
      <span class="tool-icon-emoji">{{ toolInfo.icon }}</span>
      <span class="tool-label">{{ toolInfo.label }}</span>
      <span class="tool-summary">{{ summary }}</span>
      <span class="tool-expand">{{ expanded ? '▾' : '▸' }}</span>
      <span v-if="toolResult" class="tool-badge result">done</span>
    </div>

    <!-- Expanded detail -->
    <div v-if="expanded" class="tool-detail">
      <!-- Bash: show command and output -->
      <div v-if="isBash" class="bash-block">
        <div class="bash-command">$ {{ toolInput.command }}</div>
        <pre v-if="toolInput.description" class="bash-desc">{{ toolInput.description }}</pre>
      </div>

      <!-- Edit: show diff -->
      <div v-else-if="isEdit && toolInput" class="edit-diff">
        <div class="diff-file">{{ toolInput.file_path }}</div>
        <div v-if="toolInput.old_string" class="diff-removed">
          <span class="diff-marker">-</span>
          <pre>{{ toolInput.old_string }}</pre>
        </div>
        <div v-if="toolInput.new_string" class="diff-added">
          <span class="diff-marker">+</span>
          <pre>{{ toolInput.new_string }}</pre>
        </div>
      </div>

      <!-- Generic: show raw input -->
      <pre v-else-if="toolInput" class="tool-input">{{ JSON.stringify(toolInput, null, 2) }}</pre>

      <!-- Tool result -->
      <div v-if="toolResult" class="tool-result-block">
        <div class="result-label">Result:</div>
        <pre class="tool-result-content">{{ toolResult }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tool-block {
  background: var(--bg-secondary); border: 1px solid var(--bg-tertiary);
  border-radius: 6px; font-size: 12px; overflow: hidden;
}
.tool-header {
  display: flex; align-items: center; gap: 6px; padding: 6px 10px;
  cursor: pointer; transition: background 0.15s;
}
.tool-header:hover { background: var(--bg-tertiary); }
.tool-icon-emoji { font-size: 13px; flex-shrink: 0; }
.tool-label { color: var(--text-secondary); font-weight: 600; flex-shrink: 0; }
.tool-summary {
  color: var(--text-muted); font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;
}
.tool-expand { color: var(--text-muted); font-size: 10px; flex-shrink: 0; }
.tool-badge {
  font-size: 9px; padding: 1px 6px; border-radius: 3px; font-weight: 600;
  flex-shrink: 0;
}
.tool-badge.result { background: rgba(34,197,94,0.15); color: var(--success); }
.tool-detail { padding: 8px 10px; border-top: 1px solid var(--bg-tertiary); }

/* Bash */
.bash-block { font-family: 'SF Mono', 'Fira Code', monospace; }
.bash-command {
  color: var(--success); font-size: 12px; padding: 4px 8px;
  background: rgba(34,197,94,0.05); border-radius: 4px;
}
.bash-desc { color: var(--text-muted); font-size: 11px; margin-top: 4px; }

/* Edit diff */
.edit-diff { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 11px; }
.diff-file { color: var(--text-secondary); margin-bottom: 6px; font-weight: 600; }
.diff-removed {
  display: flex; background: rgba(239,68,68,0.08); border-radius: 3px;
  padding: 4px 8px; margin-bottom: 2px;
}
.diff-added {
  display: flex; background: rgba(34,197,94,0.08); border-radius: 3px;
  padding: 4px 8px;
}
.diff-marker {
  color: var(--error); font-weight: 700; margin-right: 8px; flex-shrink: 0;
  user-select: none;
}
.diff-added .diff-marker { color: var(--success); }
.diff-removed pre, .diff-added pre {
  margin: 0; white-space: pre-wrap; word-break: break-all; color: var(--text-secondary);
}

/* Generic */
.tool-input {
  font-size: 11px; color: var(--text-secondary); white-space: pre-wrap;
  word-break: break-all; max-height: 200px; overflow-y: auto; margin: 0;
}
.tool-result-block { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--bg-tertiary); }
.result-label { font-size: 10px; color: var(--text-muted); margin-bottom: 4px; font-weight: 600; }
.tool-result-content {
  font-size: 11px; color: var(--text-secondary); white-space: pre-wrap;
  word-break: break-all; max-height: 200px; overflow-y: auto; margin: 0;
}
</style>
