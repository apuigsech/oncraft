<script setup lang="ts">
import type { ColumnConfig, GitHubConfig } from '~/types';

const emit = defineEmits<{ close: [] }>();
const projectsStore = useProjectsStore();
const pipelinesStore = usePipelinesStore();
const cardsStore = useCardsStore();

const saveError = ref<string | null>(null);
const saveSuccess = ref(false);
const dirty = ref(false);
const saving = ref(false);

const project = computed(() => projectsStore.activeProject);
const config = computed(() => {
  if (!project.value) return null;
  return pipelinesStore.getConfig(project.value.path) || null;
});

// Local draft state — changes accumulate here until Save is pressed
const draftColumns = ref<ColumnConfig[]>([]);
const draftGithubRepo = ref('');

// Track columns that were removed/renamed so we can apply card migrations on save
const pendingRemovals = ref<string[]>([]);
const pendingRenames = ref<{ oldName: string; newName: string }[]>([]);

// Initialize drafts from loaded config
watch(config, (cfg) => {
  if (cfg) {
    draftColumns.value = cfg.columns.map(c => ({ ...c }));
    draftGithubRepo.value = cfg.github?.repository || '';
    dirty.value = false;
    pendingRemovals.value = [];
    pendingRenames.value = [];
  }
}, { immediate: true });

function onColumnsUpdate(columns: ColumnConfig[]) {
  draftColumns.value = columns;
  dirty.value = true;
}

function onColumnRemoved(removedName: string) {
  pendingRemovals.value.push(removedName);
  dirty.value = true;
}

function onColumnRenamed(oldName: string, newName: string) {
  pendingRenames.value.push({ oldName, newName });
  dirty.value = true;
}

function onGithubRepoInput() {
  dirty.value = true;
}

async function save() {
  if (!project.value || !config.value) return;
  saving.value = true;
  saveError.value = null;

  try {
    // Build the new config
    const github: GitHubConfig = {};
    const trimmedRepo = draftGithubRepo.value.trim();
    if (trimmedRepo) github.repository = trimmedRepo;

    const newConfig = {
      columns: draftColumns.value,
      ...(trimmedRepo ? { github } : {}),
    };

    await pipelinesStore.saveConfig(project.value.path, newConfig);

    // Apply card migrations for removed columns
    for (const removedName of pendingRemovals.value) {
      const targetColumn = draftColumns.value[0]?.name;
      if (targetColumn) {
        const affectedCards = cardsStore.cards.filter(c => c.columnName === removedName);
        for (const card of affectedCards) {
          await cardsStore.moveCard(card.id, targetColumn, 0);
        }
      }
    }

    // Apply card migrations for renamed columns
    for (const { oldName, newName } of pendingRenames.value) {
      const affectedCards = cardsStore.cards.filter(c => c.columnName === oldName);
      for (const card of affectedCards) {
        await cardsStore.moveCard(card.id, newName, card.columnOrder);
      }
    }

    pendingRemovals.value = [];
    pendingRenames.value = [];
    dirty.value = false;
    saveSuccess.value = true;
    setTimeout(() => { saveSuccess.value = false; }, 2000);
  } catch (err) {
    saveError.value = `Failed to save: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="dialog-overlay" @click.self="emit('close')">
    <div class="dialog">
      <div class="dialog-header">
        <h3>Project Settings</h3>
        <button class="close-btn" @click="emit('close')">&times;</button>
      </div>
      <div class="dialog-body">
        <div v-if="project" class="settings-content">
          <!-- Status feedback -->
          <div v-if="saveError" class="save-feedback error">{{ saveError }}</div>
          <div v-if="saveSuccess" class="save-feedback success">Settings saved to .oncraft/config.yaml</div>

          <div class="field">
            <span class="field-label">Project Path</span>
            <span class="field-value mono">{{ project.path }}</span>
          </div>

          <!-- GitHub settings -->
          <div class="settings-section">
            <h4>GitHub</h4>
            <div class="field">
              <label class="field-label" for="github-repo">Repository</label>
              <input
                id="github-repo"
                v-model="draftGithubRepo"
                type="text"
                class="field-input"
                placeholder="owner/repo"
                @input="onGithubRepoInput"
              />
              <span class="field-hint">e.g. apuigsech/oncraft</span>
            </div>
          </div>

          <ColumnEditor
            v-if="config"
            :columns="draftColumns"
            @update="onColumnsUpdate"
            @column-removed="onColumnRemoved"
            @column-renamed="onColumnRenamed"
          />
        </div>
      </div>
      <div class="dialog-footer">
        <div class="footer-actions">
          <button class="btn-secondary" @click="emit('close')">Close</button>
          <button
            class="btn-primary"
            :disabled="!dirty || saving"
            @click="save"
          >
            {{ saving ? 'Saving...' : 'Save' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; }
.dialog { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; width: 500px; max-height: 80vh; display: flex; flex-direction: column; }
.dialog-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--border); }
.dialog-header h3 { font-size: 16px; }
.close-btn { font-size: 18px; color: var(--text-muted); padding: 2px 6px; border-radius: 4px; }
.close-btn:hover { background: var(--bg-tertiary); }
.dialog-body { flex: 1; overflow-y: auto; padding: 18px; }
.settings-content { display: flex; flex-direction: column; gap: 16px; }
.settings-section { display: flex; flex-direction: column; gap: 8px; }
.settings-section h4 { font-size: 14px; color: var(--text-primary); margin: 0; }
.field { display: flex; flex-direction: column; gap: 4px; }
.field-label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
.field-value { font-size: 13px; color: var(--text-secondary); }
.field-input {
  background: var(--bg-primary); border: 1px solid var(--border);
  border-radius: 4px; padding: 6px 8px; font-size: 13px;
  color: var(--text-primary);
}
.field-input:focus { outline: none; border-color: var(--accent); }
.field-hint { font-size: 11px; color: var(--text-muted); }
.mono { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px; background: var(--bg-primary); padding: 4px 8px; border-radius: 4px; }
.dialog-footer { display: flex; justify-content: space-between; align-items: center; padding: 12px 18px; border-top: 1px solid var(--border); }
.footer-actions { display: flex; gap: 8px; margin-left: auto; }
.btn-secondary { padding: 6px 16px; border-radius: 4px; font-size: 13px; color: var(--text-secondary); }
.btn-secondary:hover { background: var(--bg-tertiary); }
.btn-primary {
  padding: 6px 16px; border-radius: 4px; font-size: 13px;
  background: var(--accent); color: white; font-weight: 500;
}
.btn-primary:hover:not(:disabled) { opacity: 0.9; }
.btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
.save-feedback { padding: 6px 10px; border-radius: 4px; font-size: 12px; }
.save-feedback.error { background: rgba(239, 68, 68, 0.1); color: var(--error); border: 1px solid rgba(239, 68, 68, 0.3); }
.save-feedback.success { background: rgba(34, 197, 94, 0.1); color: #22c55e; border: 1px solid rgba(34, 197, 94, 0.3); }
</style>
