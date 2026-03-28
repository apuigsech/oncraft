<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core';
import type { PresetSummary } from '~/services/flow-loader';

const open = defineModel<boolean>('open', { default: true });

const emit = defineEmits<{ close: [] }>();
const projectsStore = useProjectsStore();
const flowStore = useFlowStore();
const cardsStore = useCardsStore();

const project = computed(() => projectsStore.activeProject);

// ── Draft state (local until Apply) ──
const draftPreset = ref('');
const draftGhOverride = ref('');

// Track if anything changed
const hasChanges = computed(() => {
  const presetChanged = draftPreset.value !== (flowStore.flow?.preset ?? '');
  const ghChanged = draftGhOverride.value !== (flowStore.githubConfigRepo ?? '');
  return presetChanged || ghChanged;
});

// ── Flow Preset ──
const presets = ref<PresetSummary[]>([]);
const presetsLoading = ref(false);
const localOverrides = ref(false);

const presetItems = computed(() =>
  presets.value.map(p => ({
    label: p.name,
    value: p.name,
    description: `${p.stateCount} states`,
  }))
);

const presetPreview = computed(() => {
  return presets.value.find(p => p.name === draftPreset.value);
});

// ── GitHub ──
const activeRepo = computed(() => flowStore.githubRepository);
const isOverride = computed(() => !!flowStore.githubConfigRepo);

// ── Cleanup ──
const orphanedSessions = ref<string[]>([]);
const orphanedWorktrees = ref<string[]>([]);
const cleanupLoading = ref(false);

async function detectOrphans() {
  if (!project.value) return;
  cleanupLoading.value = true;
  try {
    const cardSessionIds = cardsStore.cards.map(c => c.sessionId).filter(Boolean);
    const cardWorktreeNames = cardsStore.cards.map(c => c.worktreeName).filter(Boolean) as string[];

    const [sessions, worktrees] = await Promise.allSettled([
      invoke<string[]>('list_orphaned_sessions', {
        projectPath: project.value.path,
        cardSessionIds,
      }).catch(() => [] as string[]),
      invoke<string[]>('list_orphaned_worktrees', {
        projectPath: project.value.path,
        cardWorktreeNames,
      }).catch(() => [] as string[]),
    ]);

    orphanedSessions.value = sessions.status === 'fulfilled' ? sessions.value : [];
    orphanedWorktrees.value = worktrees.status === 'fulfilled' ? worktrees.value : [];
  } finally {
    cleanupLoading.value = false;
  }
}

async function cleanSessions() {
  const count = orphanedSessions.value.length;
  const { ask } = await import('@tauri-apps/plugin-dialog');
  const confirmed = await ask(
    `Delete ${count} orphaned session${count > 1 ? 's' : ''}? This cannot be undone.`,
    { title: 'Clean Orphaned Sessions', kind: 'warning' },
  );
  if (!confirmed) return;

  for (const sessionId of orphanedSessions.value) {
    try {
      await invoke('delete_session', { sessionId, projectPath: project.value?.path });
    } catch { /* skip */ }
  }
  orphanedSessions.value = [];
}

async function cleanWorktrees() {
  if (!project.value) return;
  const count = orphanedWorktrees.value.length;
  const { ask } = await import('@tauri-apps/plugin-dialog');
  const confirmed = await ask(
    `Remove ${count} orphaned worktree${count > 1 ? 's' : ''}? This cannot be undone.`,
    { title: 'Clean Orphaned Worktrees', kind: 'warning' },
  );
  if (!confirmed) return;

  for (const name of orphanedWorktrees.value) {
    try {
      const { Command } = await import('@tauri-apps/plugin-shell');
      await new Command('git', ['worktree', 'remove', name], { cwd: project.value!.path }).execute();
    } catch { /* skip */ }
  }
  orphanedWorktrees.value = [];
}

// ── Apply / Cancel ──
const applying = ref(false);

async function apply() {
  if (!project.value || !hasChanges.value) return;
  applying.value = true;
  try {
    const currentPresetName = flowStore.flow?.preset ?? '';
    const currentGh = flowStore.githubConfigRepo ?? '';

    if (draftPreset.value !== currentPresetName) {
      await flowStore.changePreset(project.value.path, draftPreset.value);
    }
    if (draftGhOverride.value !== currentGh) {
      const repo = draftGhOverride.value.trim() || undefined;
      await flowStore.setGitHubRepository(project.value.path, repo);
    }
  } finally {
    applying.value = false;
  }
  close();
}

function close() {
  emit('close');
  open.value = false;
}

// ── Init ──
onMounted(async () => {
  // Initialize drafts from current state
  draftPreset.value = flowStore.flow?.preset ?? '';
  draftGhOverride.value = flowStore.githubConfigRepo ?? '';

  presetsLoading.value = true;
  try {
    const [presetList, hasOverrides] = await Promise.all([
      flowStore.listPresets(),
      project.value ? flowStore.hasLocalOverrides(project.value.path) : false,
    ]);
    presets.value = presetList;
    localOverrides.value = hasOverrides;
  } finally {
    presetsLoading.value = false;
  }
  detectOrphans();
});
</script>

<template>
  <UModal
    v-model:open="open"
    :ui="{ content: 'sm:max-w-[700px]' }"
    @update:open="(val: boolean) => { if (!val) close() }"
  >
    <template #header>
      <div class="modal-header">
        <h2 class="modal-title">Project Settings</h2>
        <p v-if="project" class="modal-subtitle">{{ project.name }} — {{ project.path }}</p>
      </div>
    </template>

    <template #body>
      <div v-if="project" class="settings-body">

        <!-- ═══ Flow Preset ═══ -->
        <section class="section">
          <div class="section-header">
            <h3 class="section-title">Flow Preset</h3>
            <p class="section-subtitle">Workflow template for this project</p>
          </div>
          <div class="grouped-card">
            <div class="card-row">
              <USelectMenu
                v-model="draftPreset"
                :items="presetItems"
                :loading="presetsLoading"
                size="sm"
                value-key="value"
                :search-input="false"
                class="preset-select"
                placeholder="Select preset..."
                :ui="{
                  trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200'
                }"
              />
            </div>

            <!-- Preset preview -->
            <div v-if="presetPreview" class="card-row card-row--preview">
              <div class="preview-info">
                <span class="preview-meta">{{ presetPreview.stateCount }} states</span>
                <span v-if="presetPreview.agent.model" class="preview-meta">· model: {{ presetPreview.agent.model }}</span>
                <span v-if="presetPreview.agent.effort" class="preview-meta">· effort: {{ presetPreview.agent.effort }}</span>
              </div>
              <div class="pipeline">
                <template v-for="(state, i) in presetPreview.states" :key="state.slug">
                  <span v-if="i > 0" class="pipeline-arrow">→</span>
                  <span
                    class="pipeline-badge"
                    :style="{
                      background: state.color + '18',
                      borderColor: state.color + '40',
                      color: state.color,
                    }"
                  >{{ state.name }}</span>
                </template>
              </div>
            </div>

            <!-- Local overrides warning -->
            <div v-if="localOverrides" class="card-row card-row--warning">
              <UIcon name="i-lucide-alert-triangle" class="warning-icon" />
              <span class="warning-text">This project has local state overrides in <code>.oncraft/states/</code>. Switching presets won't remove them.</span>
            </div>
          </div>
        </section>

        <!-- ═══ GitHub ═══ -->
        <section class="section">
          <div class="section-header">
            <h3 class="section-title">GitHub</h3>
            <p class="section-subtitle">Repository connection</p>
          </div>
          <div class="grouped-card">
            <!-- Active repo -->
            <div class="card-row">
              <div class="row-info row-info--health">
                <div
                  class="status-dot"
                  :class="activeRepo ? 'status-dot--green' : 'status-dot--neutral'"
                />
                <span class="row-label">{{ activeRepo || 'No repository detected' }}</span>
              </div>
              <span v-if="activeRepo" class="row-badge">{{ isOverride ? 'override' : 'auto-detected' }}</span>
            </div>

            <!-- Override input -->
            <div class="card-row card-row--input">
              <div class="row-info">
                <span class="row-label">Repository override</span>
              </div>
              <UInput
                v-model="draftGhOverride"
                size="sm"
                placeholder="owner/repo"
                :ui="{ base: 'font-mono text-xs' }"
                class="gh-input"
              />
            </div>
          </div>
        </section>

        <!-- ═══ Cleanup ═══ -->
        <section class="section">
          <div class="section-header">
            <h3 class="section-title">Cleanup</h3>
            <p class="section-subtitle">Remove orphaned resources</p>
          </div>
          <div class="grouped-card">
            <!-- Orphaned sessions -->
            <div class="card-row">
              <div class="row-info">
                <span class="row-label">Orphaned sessions</span>
                <span class="row-desc">Sessions without a matching card</span>
              </div>
              <div class="cleanup-action">
                <span v-if="cleanupLoading" class="cleanup-count cleanup-count--muted">Scanning...</span>
                <span v-else-if="orphanedSessions.length" class="cleanup-count cleanup-count--warn">{{ orphanedSessions.length }} found</span>
                <span v-else class="cleanup-count cleanup-count--ok">None</span>
                <UButton
                  v-if="orphanedSessions.length"
                  variant="outline"
                  color="neutral"
                  size="xs"
                  @click="cleanSessions"
                >
                  Clean
                </UButton>
              </div>
            </div>

            <!-- Orphaned worktrees -->
            <div class="card-row">
              <div class="row-info">
                <span class="row-label">Orphaned worktrees</span>
                <span class="row-desc">Git worktrees without a matching card</span>
              </div>
              <div class="cleanup-action">
                <span v-if="cleanupLoading" class="cleanup-count cleanup-count--muted">Scanning...</span>
                <span v-else-if="orphanedWorktrees.length" class="cleanup-count cleanup-count--warn">{{ orphanedWorktrees.length }} found</span>
                <span v-else class="cleanup-count cleanup-count--ok">None</span>
                <UButton
                  v-if="orphanedWorktrees.length"
                  variant="outline"
                  color="neutral"
                  size="xs"
                  @click="cleanWorktrees"
                >
                  Clean
                </UButton>
              </div>
            </div>
          </div>
        </section>
      </div>
    </template>

    <template #footer>
      <div class="footer-actions">
        <UButton variant="ghost" color="neutral" @click="close">Cancel</UButton>
        <UButton
          color="primary"
          :disabled="!hasChanges"
          :loading="applying"
          @click="apply"
        >
          Apply
        </UButton>
      </div>
    </template>
  </UModal>
</template>

<style scoped>
/* Modal header */
.modal-header { display: flex; flex-direction: column; gap: 2px; }
.modal-title { font-size: 15px; font-weight: 600; color: var(--text-primary); margin: 0; }
.modal-subtitle { font-size: 11px; color: var(--text-muted); margin: 0; }

/* Body */
.settings-body { display: flex; flex-direction: column; gap: 20px; }

/* Sections */
.section { display: flex; flex-direction: column; gap: 8px; }
.section-header { margin-bottom: 2px; }
.section-title { font-size: 12px; font-weight: 600; color: var(--text-primary); margin: 0; }
.section-subtitle { font-size: 10px; color: var(--text-muted); margin: 2px 0 0; }

/* Grouped card */
.grouped-card {
  background: var(--bg-primary);
  border-radius: 10px;
  border: 1px solid var(--border);
  overflow: hidden;
}

/* Card rows */
.card-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
}
.card-row:last-child { border-bottom: none; }

.card-row--preview {
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.card-row--warning {
  gap: 8px;
  justify-content: flex-start;
  background: color-mix(in srgb, #fbbf24 5%, transparent);
}

.card-row--input {
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
}

/* Row content */
.row-info { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.row-info--health { flex-direction: row; align-items: center; gap: 8px; }
.row-label { font-size: 12px; color: var(--text-primary); }
.row-desc { font-size: 10px; color: var(--text-muted); }
.row-badge {
  font-size: 10px;
  color: var(--text-muted);
  padding: 2px 6px;
  background: var(--bg-tertiary);
  border-radius: 4px;
  flex-shrink: 0;
}

/* Status dot */
.status-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.status-dot--green { background: var(--success); }
.status-dot--neutral { background: var(--text-muted); }

/* Preset select */
.preset-select { width: 100%; }

/* Preview */
.preview-info { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.preview-meta { font-size: 10px; color: var(--text-muted); }

.pipeline { display: flex; align-items: center; gap: 0; flex-wrap: wrap; }
.pipeline-arrow { font-size: 10px; color: var(--text-muted); padding: 0 4px; }
.pipeline-badge {
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid;
  font-size: 10px;
  font-weight: 500;
}

/* Warning */
.warning-icon { width: 14px; height: 14px; color: #fbbf24; flex-shrink: 0; }
.warning-text { font-size: 11px; color: var(--text-secondary); line-height: 1.4; }
.warning-text code {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 10px;
  background: var(--bg-tertiary);
  padding: 1px 4px;
  border-radius: 3px;
}

/* GitHub input */
.gh-input { width: 100%; }

/* Cleanup */
.cleanup-action { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.cleanup-count { font-size: 11px; }
.cleanup-count--warn { color: #fbbf24; }
.cleanup-count--ok { color: var(--success); }
.cleanup-count--muted { color: var(--text-muted); }

/* Footer */
.footer-actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
