<script setup lang="ts">
import type { StreamMessage } from '~/types';

const props = defineProps<{ message: StreamMessage; cardId: string }>();
const expanded = ref(false);
const sessionsStore = useSessionsStore();

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

const toolInfo = computed(() => TOOL_INFO[props.message.toolName || ''] || { icon: '🔧', label: props.message.toolName || 'Tool' });

const summary = computed(() => {
  const input = props.message.toolInput || {};
  const name = props.message.toolName || '';
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

const isEdit = computed(() => props.message.toolName === 'Edit');
const isBash = computed(() => props.message.toolName === 'Bash');

async function approve() { await sessionsStore.approveToolUse(props.cardId); }
async function reject() { await sessionsStore.rejectToolUse(props.cardId); }
</script>

<template>
  <div class="tool-block" :class="{ 'is-confirmation': message.type === 'tool_confirmation' }">
    <div class="tool-header" @click="expanded = !expanded">
      <span class="tool-icon-emoji">{{ toolInfo.icon }}</span>
      <span class="tool-label">{{ toolInfo.label }}</span>
      <span class="tool-summary">{{ summary }}</span>
      <span class="tool-expand">{{ expanded ? '▾' : '▸' }}</span>
      <span v-if="message.toolResult" class="tool-badge result">done</span>
      <span v-if="message.type === 'tool_confirmation'" class="tool-badge confirm">needs approval</span>
    </div>

    <!-- Approval buttons for tool confirmation -->
    <div v-if="message.type === 'tool_confirmation'" class="tool-confirm">
      <div class="confirm-actions">
        <button class="btn-approve" @click.stop="approve">Allow</button>
        <button class="btn-reject" @click.stop="reject">Deny</button>
      </div>
    </div>

    <!-- Expanded detail -->
    <div v-if="expanded" class="tool-detail">
      <!-- Bash: show command and output -->
      <div v-if="isBash" class="bash-block">
        <div class="bash-command">$ {{ message.toolInput?.command }}</div>
        <pre v-if="message.toolInput?.description" class="bash-desc">{{ message.toolInput.description }}</pre>
      </div>

      <!-- Edit: show diff -->
      <div v-else-if="isEdit && message.toolInput" class="edit-diff">
        <div class="diff-file">{{ message.toolInput.file_path }}</div>
        <div v-if="message.toolInput.old_string" class="diff-removed">
          <span class="diff-marker">-</span>
          <pre>{{ message.toolInput.old_string }}</pre>
        </div>
        <div v-if="message.toolInput.new_string" class="diff-added">
          <span class="diff-marker">+</span>
          <pre>{{ message.toolInput.new_string }}</pre>
        </div>
      </div>

      <!-- Generic: show raw input -->
      <pre v-else-if="message.toolInput" class="tool-input">{{ JSON.stringify(message.toolInput, null, 2) }}</pre>

      <!-- Tool result -->
      <div v-if="message.toolResult" class="tool-result-block">
        <div class="result-label">Result:</div>
        <pre class="tool-result-content">{{ message.toolResult }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tool-block {
  background: var(--bg-secondary); border: 1px solid var(--bg-tertiary);
  border-radius: 6px; font-size: 12px; overflow: hidden;
}
.tool-block.is-confirmation { border-color: var(--warning); }
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
.tool-badge.confirm { background: rgba(251,191,36,0.2); color: var(--warning); }

.tool-confirm { padding: 6px 10px; border-top: 1px solid var(--bg-tertiary); }
.confirm-actions { display: flex; gap: 8px; }
.btn-approve {
  background: var(--success); color: white; padding: 4px 14px;
  border-radius: 4px; font-size: 12px; font-weight: 600;
}
.btn-reject {
  background: transparent; color: var(--text-muted); padding: 4px 14px;
  border-radius: 4px; font-size: 12px; border: 1px solid var(--bg-tertiary);
}
.btn-reject:hover { border-color: var(--error); color: var(--error); }

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
