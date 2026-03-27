<script setup lang="ts">
import type { SessionInfo } from '~/services/claude-process';
import { listSessionsViaSidecar } from '~/services/claude-process';

const props = defineProps<{
  projectId: string;
  projectPath: string;
  columnName: string;
}>();

const open = defineModel<boolean>('open', { default: true });

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
  close();
}

function close() {
  emit('close');
  open.value = false;
}

onMounted(async () => {
  sessions.value = await listSessionsViaSidecar(props.projectPath);
  loading.value = false;
});
</script>

<template>
  <UModal v-model:open="open" :title="`Import Sessions into &quot;${columnName}&quot;`" :ui="{ content: 'sm:max-w-[500px]' }" @update:open="(val: boolean) => { if (!val) close() }">
    <template #body>
      <div v-if="loading" class="loading">Loading sessions...</div>

      <template v-else>
        <div class="search-row">
          <UInput v-model="search" placeholder="Search sessions..." size="sm" class="flex-1" />
          <UButton variant="link" color="primary" size="xs" @click="selectAll">
            {{ selected.size === filteredSessions.length ? 'Deselect all' : 'Select all' }}
          </UButton>
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
            <UCheckbox :model-value="selected.has(session.sessionId)" @click.stop />
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
    </template>
    <template #footer>
      <div class="flex justify-between items-center w-full">
        <span class="selected-count">{{ selected.size }} selected</span>
        <div class="flex gap-2">
          <UButton variant="ghost" color="neutral" @click="close">Cancel</UButton>
          <UButton :disabled="selected.size === 0 || importing" :loading="importing" @click="importSelected">
            {{ importing ? 'Importing...' : `Import ${selected.size} session${selected.size !== 1 ? 's' : ''}` }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>

<style scoped>
.loading { text-align: center; color: var(--text-muted); padding: 30px; }
.empty { text-align: center; color: var(--text-muted); padding: 20px; font-size: 13px; }

.search-row { display: flex; gap: 8px; margin-bottom: 10px; align-items: center; }

.sessions-list { display: flex; flex-direction: column; gap: 2px; max-height: 40vh; overflow-y: auto; }
.session-item {
  display: flex; align-items: center; gap: 10px; padding: 8px 10px;
  border-radius: 4px; cursor: pointer; transition: background 0.1s;
}
.session-item:hover { background: var(--bg-tertiary); }
.session-item.selected { background: rgba(59,130,246,0.1); }
.session-info { flex: 1; min-width: 0; }
.session-summary { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.session-meta { display: flex; gap: 8px; font-size: 11px; color: var(--text-muted); margin-top: 2px; }
.session-branch { font-family: monospace; background: var(--bg-tertiary); padding: 0 4px; border-radius: 2px; }
.session-id { font-family: monospace; }
.selected-count { font-size: 12px; color: var(--text-muted); }
</style>
