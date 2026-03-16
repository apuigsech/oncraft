<script setup lang="ts">
import type { SessionInfo } from '~/services/claude-process';
import { listSessionsViaSidecar } from '~/services/claude-process';

const props = defineProps<{
  projectId: string;
  projectPath: string;
  columnName: string;
}>();

const emit = defineEmits<{ close: [] }>();
const cardsStore = useCardsStore();

const loading = ref(true);
const sessions = ref<SessionInfo[]>([]);
const selected = ref<Set<string>>(new Set());
const importing = ref(false);
const search = ref('');

// Filter out sessions that are already imported as cards
const existingSessionIds = computed(() =>
  new Set(cardsStore.cards.map(c => c.sessionId).filter(Boolean))
);

const filteredSessions = computed(() => {
  let list = sessions.value.filter(s => !existingSessionIds.value.has(s.sessionId));
  if (search.value.trim()) {
    const q = search.value.toLowerCase();
    list = list.filter(s => s.summary.toLowerCase().includes(q) || s.sessionId.includes(q));
  }
  return list;
});

function toggleSelect(sessionId: string) {
  if (selected.value.has(sessionId)) {
    selected.value.delete(sessionId);
  } else {
    selected.value.add(sessionId);
  }
  // Force reactivity
  selected.value = new Set(selected.value);
}

function selectAll() {
  if (selected.value.size === filteredSessions.value.length) {
    selected.value = new Set();
  } else {
    selected.value = new Set(filteredSessions.value.map(s => s.sessionId));
  }
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

async function importSelected() {
  importing.value = true;
  for (const sessionId of selected.value) {
    const session = sessions.value.find(s => s.sessionId === sessionId);
    if (!session) continue;
    const name = session.summary.substring(0, 60) || `Session ${sessionId.substring(0, 8)}`;
    const card = await cardsStore.addCard(props.projectId, props.columnName, name, '');
    // Update card with the real session ID
    await cardsStore.updateCardSessionId(card.id, sessionId);
  }
  importing.value = false;
  emit('close');
}

onMounted(async () => {
  sessions.value = await listSessionsViaSidecar(props.projectPath);
  loading.value = false;
});
</script>

<template>
  <div class="dialog-overlay" @click.self="emit('close')">
    <div class="dialog">
      <div class="dialog-header">
        <h3>Import Sessions into "{{ columnName }}"</h3>
        <button class="close-btn" @click="emit('close')">x</button>
      </div>

      <div class="dialog-body">
        <div v-if="loading" class="loading">Loading sessions...</div>

        <template v-else>
          <div class="search-row">
            <input v-model="search" placeholder="Search sessions..." class="search-input" />
            <button class="select-all-btn" @click="selectAll">
              {{ selected.size === filteredSessions.length ? 'Deselect all' : 'Select all' }}
            </button>
          </div>

          <div v-if="filteredSessions.length === 0" class="empty">
            {{ sessions.length === 0 ? 'No sessions found for this project' : 'All sessions already imported' }}
          </div>

          <div class="sessions-list">
            <div
              v-for="session in filteredSessions" :key="session.sessionId"
              class="session-item" :class="{ selected: selected.has(session.sessionId) }"
              @click="toggleSelect(session.sessionId)"
            >
              <input type="checkbox" :checked="selected.has(session.sessionId)" class="checkbox" />
              <div class="session-info">
                <div class="session-summary">{{ session.summary }}</div>
                <div class="session-meta">
                  <span>{{ formatDate(session.lastModified) }}</span>
                  <span v-if="session.gitBranch" class="session-branch">{{ session.gitBranch }}</span>
                  <span class="session-id">{{ session.sessionId.substring(0, 8) }}</span>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>

      <div class="dialog-footer">
        <span class="selected-count">{{ selected.size }} selected</span>
        <div class="footer-actions">
          <button class="btn-secondary" @click="emit('close')">Cancel</button>
          <button class="btn-primary" :disabled="selected.size === 0 || importing" @click="importSelected">
            {{ importing ? 'Importing...' : `Import ${selected.size} session${selected.size !== 1 ? 's' : ''}` }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; }
.dialog { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; width: 500px; max-height: 70vh; display: flex; flex-direction: column; }
.dialog-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--border); }
.dialog-header h3 { font-size: 15px; }
.close-btn { font-size: 16px; color: var(--text-muted); padding: 2px 6px; border-radius: 4px; }
.close-btn:hover { background: var(--bg-tertiary); }

.dialog-body { flex: 1; overflow-y: auto; padding: 12px 18px; }
.loading { text-align: center; color: var(--text-muted); padding: 30px; }
.empty { text-align: center; color: var(--text-muted); padding: 20px; font-size: 13px; }

.search-row { display: flex; gap: 8px; margin-bottom: 10px; }
.search-input { flex: 1; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 4px; padding: 6px 10px; font-size: 13px; }
.search-input:focus { outline: none; border-color: var(--accent); }
.select-all-btn { font-size: 11px; color: var(--accent); white-space: nowrap; padding: 0 8px; }

.sessions-list { display: flex; flex-direction: column; gap: 2px; }
.session-item {
  display: flex; align-items: center; gap: 10px; padding: 8px 10px;
  border-radius: 4px; cursor: pointer; transition: background 0.1s;
}
.session-item:hover { background: var(--bg-tertiary); }
.session-item.selected { background: rgba(59,130,246,0.1); }
.checkbox { flex-shrink: 0; pointer-events: none; accent-color: var(--accent); }
.session-info { flex: 1; min-width: 0; }
.session-summary { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.session-meta { display: flex; gap: 8px; font-size: 11px; color: var(--text-muted); margin-top: 2px; }
.session-branch { font-family: monospace; background: var(--bg-tertiary); padding: 0 4px; border-radius: 2px; }
.session-id { font-family: monospace; }

.dialog-footer { display: flex; justify-content: space-between; align-items: center; padding: 12px 18px; border-top: 1px solid var(--border); }
.selected-count { font-size: 12px; color: var(--text-muted); }
.footer-actions { display: flex; gap: 8px; }
.btn-primary { background: var(--accent); color: white; padding: 6px 16px; border-radius: 4px; font-size: 13px; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary { padding: 6px 16px; border-radius: 4px; font-size: 13px; color: var(--text-secondary); }
.btn-secondary:hover { background: var(--bg-tertiary); }
</style>
