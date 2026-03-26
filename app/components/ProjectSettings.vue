<script setup lang="ts">
import { checkGhStatus } from '~/services/github';

const open = defineModel<boolean>('open', { default: true });

const emit = defineEmits<{ close: [] }>();
const projectsStore = useProjectsStore();
const flowStore = useFlowStore();

const project = computed(() => projectsStore.activeProject);

// GitHub config
const ghOverride = ref('');
const ghStatus = ref<{ installed: boolean; authenticated: boolean }>({ installed: true, authenticated: true });
const ghStatusLoading = ref(true);

// Sync ghOverride when the store value loads (async auto-detect may resolve later)
watch(() => flowStore.githubConfigRepo, (val) => {
  if (val && !ghOverride.value) ghOverride.value = val;
}, { immediate: true });

onMounted(async () => {
  try {
    ghStatus.value = await checkGhStatus();
  } finally {
    ghStatusLoading.value = false;
  }
});

async function saveGhOverride() {
  if (!project.value) return;
  const repo = ghOverride.value.trim() || undefined;
  await flowStore.setGitHubRepository(project.value.path, repo);
}

async function openFlowConfig() {
  if (!project.value) return;
  try {
    const { openPath } = await import('@tauri-apps/plugin-opener');
    await openPath(`${project.value.path}/.oncraft`);
  } catch {
    try {
      const { openPath } = await import('@tauri-apps/plugin-opener');
      await openPath(project.value!.path);
    } catch { /* ignore */ }
  }
}

function close() {
  emit('close');
  open.value = false;
}
</script>

<template>
  <UModal v-model:open="open" title="Project Settings" :ui="{ width: 'sm:max-w-[500px]' }" @update:open="(val: boolean) => { if (!val) close() }">
    <template #body>
      <div v-if="project" class="settings-content">
        <div class="field">
          <span class="field-label">Project Path</span>
          <span class="field-value mono">{{ project.path }}</span>
        </div>

        <!-- Flow summary -->
        <div class="settings-section">
          <h4>Flow</h4>
          <div v-if="flowStore.flow" class="flow-summary">
            <div class="field">
              <span class="field-label">Name</span>
              <span class="field-value">{{ flowStore.flow.name }}</span>
            </div>
            <div v-if="flowStore.flow.preset" class="field">
              <span class="field-label">Preset</span>
              <span class="field-value mono">{{ flowStore.flow.preset }}</span>
            </div>
            <div class="field">
              <span class="field-label">States</span>
              <div class="states-list">
                <span
                  v-for="slug in flowStore.stateOrder"
                  :key="slug"
                  class="state-chip"
                  :style="{ borderColor: flowStore.getFlowState(slug)?.color }"
                >
                  {{ flowStore.getFlowState(slug)?.name ?? slug }}
                </span>
              </div>
            </div>
            <div v-if="flowStore.flowWarnings.length" class="field">
              <span class="field-label warnings-label">
                <UIcon name="i-lucide-alert-triangle" /> Warnings
              </span>
              <ul class="warnings-list">
                <li v-for="w in flowStore.flowWarnings" :key="w.message">{{ w.message }}</li>
              </ul>
            </div>
          </div>
          <div v-else class="field-value muted">Loading flow…</div>

          <UButton variant="outline" color="neutral" size="sm" icon="i-lucide-folder-open" class="mt-1" @click="openFlowConfig">
            Edit Flow Config (.oncraft/)
          </UButton>
        </div>

        <!-- GitHub Integration -->
        <div class="settings-section">
          <h4>GitHub</h4>
          <div class="gh-section">
            <div class="field">
              <span class="field-label">Status</span>
              <span v-if="ghStatusLoading" class="field-value muted">Checking...</span>
              <span v-else-if="!ghStatus.installed" class="field-value gh-warning">
                <UIcon name="i-lucide-alert-triangle" /> gh CLI not found. Install from cli.github.com
              </span>
              <span v-else-if="!ghStatus.authenticated" class="field-value gh-warning">
                <UIcon name="i-lucide-alert-triangle" /> Not authenticated. Run: gh auth login
              </span>
              <span v-else class="field-value gh-ok">
                <UIcon name="i-lucide-check-circle" /> Connected
              </span>
            </div>

            <div v-if="flowStore.githubDetectedRepo" class="field">
              <span class="field-label">Auto-detected</span>
              <span class="field-value mono">{{ flowStore.githubDetectedRepo }}</span>
            </div>

            <div class="field">
              <span class="field-label">Repository override</span>
              <UInput
                v-model="ghOverride"
                size="sm"
                placeholder="owner/repo"
                :ui="{ base: 'font-mono' }"
                @blur="saveGhOverride"
                @keydown.enter="saveGhOverride"
              />
              <span class="field-hint">Leave empty to use auto-detected repository</span>
            </div>

            <div v-if="flowStore.githubRepository" class="field">
              <span class="field-label">Active</span>
              <span class="field-value mono">{{ flowStore.githubRepository }}</span>
            </div>
          </div>
        </div>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end">
        <UButton variant="ghost" color="neutral" @click="close">Close</UButton>
      </div>
    </template>
  </UModal>
</template>

<style scoped>
.settings-content { display: flex; flex-direction: column; gap: 16px; }
.settings-section { display: flex; flex-direction: column; gap: 8px; }
.settings-section h4 { font-size: 14px; color: var(--text-primary); margin: 0 0 4px 0; }
.field { display: flex; flex-direction: column; gap: 4px; }
.field-label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
.field-value { font-size: 13px; color: var(--text-secondary); }
.field-value.muted { color: var(--text-muted); }
.mono { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px; background: var(--bg-primary); padding: 4px 8px; border-radius: 4px; }
.flow-summary { display: flex; flex-direction: column; gap: 10px; }
.states-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
.state-chip {
  font-size: 11px; padding: 2px 8px; border-radius: 12px;
  border: 1px solid; background: var(--bg-primary); color: var(--text-secondary);
}
.warnings-label { display: flex; align-items: center; gap: 4px; color: #fbbf24; }
.warnings-list { margin: 0; padding-left: 16px; font-size: 12px; color: #fbbf24; }
.warnings-list li { margin-bottom: 2px; }
.field-hint { font-size: 10px; color: var(--text-muted); }

.gh-section { display: flex; flex-direction: column; gap: 10px; }
.gh-warning { display: flex; align-items: center; gap: 4px; color: #fbbf24; font-size: 12px; }
.gh-ok { display: flex; align-items: center; gap: 4px; color: var(--success); font-size: 12px; }
</style>
