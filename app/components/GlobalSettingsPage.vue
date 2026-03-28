<script setup lang="ts">
import type { ChatMode, ModelAlias, EffortLevel, PermissionMode } from '~/types';
import type { HealthCheckItem } from '~/services/health-check';
import { setEnabled as telemetrySetEnabled, getEventQueue, getInstallId, type TelemetryEvent } from '~/services/telemetry';
import { CHAT_MODE_OPTIONS, MODEL_OPTIONS, MODE_OPTIONS } from '~/constants/options';

const settingsStore = useSettingsStore();

// ── Appearance ──
const selectedTheme = computed({
  get: () => settingsStore.settings.theme || 'dark',
  set: (val: 'dark' | 'light') => {
    settingsStore.settings.theme = val;
    settingsStore.save();
  },
});

// ── Session Defaults ──
const selectedChatMode = computed({
  get: () => settingsStore.settings.chatMode || 'integrated',
  set: (val: ChatMode) => {
    settingsStore.settings.chatMode = val;
    settingsStore.save();
  },
});

const selectedModel = computed({
  get: () => settingsStore.settings.defaultModel || 'sonnet',
  set: (val: ModelAlias) => {
    settingsStore.settings.defaultModel = val;
    settingsStore.save();
  },
});

const selectedEffort = computed({
  get: () => settingsStore.settings.defaultEffort || 'high',
  set: (val: EffortLevel) => {
    settingsStore.settings.defaultEffort = val;
    settingsStore.save();
  },
});

const selectedPermissionMode = computed({
  get: () => settingsStore.settings.defaultPermissionMode || 'default',
  set: (val: PermissionMode) => {
    settingsStore.settings.defaultPermissionMode = val;
    settingsStore.save();
  },
});

const currentModeIcon = computed(() => MODE_OPTIONS.find(m => m.value === selectedPermissionMode.value)?.icon);
const currentModelIcon = computed(() => MODEL_OPTIONS.find(m => m.value === selectedModel.value)?.icon);

const modeColorClass = computed(() => {
  switch (selectedPermissionMode.value) {
    case 'acceptEdits': return 'text-primary';
    case 'plan': return 'text-warning';
    case 'bypassPermissions': return 'text-error';
    default: return '';
  }
});

// ── Telemetry ──
const telemetryEnabled = computed({
  get: () => settingsStore.settings.telemetryEnabled ?? false,
  set: (val: boolean) => {
    telemetrySetEnabled(val);
  },
});
const showTelemetryDetails = ref(false);
const showTelemetryData = ref(false);
const showInstallId = ref(false);

const telemetryInstallId = computed(() => getInstallId());
const maskedInstallId = computed(() => {
  const id = telemetryInstallId.value;
  if (!id) return 'Not generated (opt-in first)';
  if (showInstallId.value) return id;
  return id.replace(/[a-f0-9]/g, 'x');
});

const telemetryEvents = computed<TelemetryEvent[]>(() => [...getEventQueue()]);

// ── System ──
const healthData = ref<HealthCheckItem[]>([]);
const healthLoading = ref(false);

async function runHealthCheck() {
  healthLoading.value = true;
  try {
    const { runHealthChecks } = await import('~/services/health-check');
    const result = await runHealthChecks();
    healthData.value = result.items;
  } catch {
    healthData.value = [{ label: 'Health Check', status: 'red', detail: 'Failed to run checks' }];
  } finally {
    healthLoading.value = false;
  }
}

onMounted(() => {
  runHealthCheck();
});

const appVersion = import.meta.env.PACKAGE_VERSION ?? 'dev';
</script>

<template>
  <div class="settings-page">
    <div class="settings-scroll">
      <!-- Page header -->
      <div class="page-header">
        <h1 class="page-title">Settings</h1>
        <p class="page-subtitle">Global preferences and defaults</p>
      </div>

      <!-- ═══ Appearance ═══ -->
      <section class="section">
        <div class="section-header">
          <h2 class="section-title">Appearance</h2>
          <p class="section-subtitle">Visual preferences</p>
        </div>
        <div class="grouped-card">
          <div class="card-row">
            <div class="row-info">
              <span class="row-label">Theme</span>
              <span class="row-desc">App color scheme</span>
            </div>
            <div class="theme-pills">
              <button
                class="pill"
                :class="{ active: selectedTheme === 'dark' }"
                @click="selectedTheme = 'dark'"
              >
                Dark
              </button>
              <button
                class="pill"
                :class="{ active: selectedTheme === 'light' }"
                @click="selectedTheme = 'light'"
              >
                Light
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- ═══ Session Defaults ═══ -->
      <section class="section">
        <div class="section-header">
          <h2 class="section-title">Session Defaults</h2>
          <p class="section-subtitle">Default values for new cards</p>
        </div>
        <div class="grouped-card">
          <!-- Chat Mode -->
          <div class="card-row card-row--chat-mode">
            <span class="row-label">Chat Mode</span>
            <div class="chat-mode-options">
              <button
                v-for="opt in CHAT_MODE_OPTIONS"
                :key="opt.value"
                class="chat-mode-card"
                :class="{ active: selectedChatMode === opt.value }"
                @click="selectedChatMode = opt.value"
              >
                <UIcon :name="opt.icon" class="chat-mode-icon" />
                <div class="chat-mode-text">
                  <span class="chat-mode-label">{{ opt.label }}</span>
                  <span class="chat-mode-desc">{{ opt.description }}</span>
                </div>
              </button>
            </div>
          </div>

          <!-- Model -->
          <div class="card-row">
            <div class="row-info">
              <span class="row-label">Model</span>
              <span class="row-desc">Default model for new sessions</span>
            </div>
            <USelectMenu
              v-model="selectedModel"
              :items="MODEL_OPTIONS"
              :icon="currentModelIcon"
              size="sm"
              variant="ghost"
              value-key="value"
              :search-input="false"
              class="row-control data-[state=open]:bg-elevated"
              :ui="{
                trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200'
              }"
            />
          </div>

          <!-- Effort -->
          <div class="card-row">
            <div class="row-info">
              <span class="row-label">Effort</span>
              <span class="row-desc">Default reasoning effort</span>
            </div>
            <EffortBar v-model="selectedEffort" />
          </div>

          <!-- Permission Mode -->
          <div class="card-row">
            <div class="row-info">
              <span class="row-label">Permission Mode</span>
              <span class="row-desc">Tool approval behavior</span>
            </div>
            <USelectMenu
              v-model="selectedPermissionMode"
              :items="MODE_OPTIONS"
              :icon="currentModeIcon"
              size="sm"
              variant="ghost"
              value-key="value"
              :search-input="false"
              :class="['row-control data-[state=open]:bg-elevated', modeColorClass]"
              :ui="{
                trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200',
                leadingIcon: modeColorClass,
                value: modeColorClass
              }"
            />
          </div>
        </div>
      </section>

      <!-- ═══ Telemetry ═══ -->
      <section class="section">
        <div class="section-header">
          <h2 class="section-title">Telemetry</h2>
          <p class="section-subtitle">Usage data and privacy</p>
        </div>
        <div class="grouped-card">
          <!-- Toggle -->
          <div class="card-row">
            <div class="row-info">
              <span class="row-label">Anonymous telemetry</span>
              <span class="row-desc">Help improve OnCraft</span>
            </div>
            <USwitch v-model="telemetryEnabled" />
          </div>

          <!-- What do we collect -->
          <div class="card-row card-row--expandable" @click="showTelemetryDetails = !showTelemetryDetails">
            <div class="row-info">
              <span class="row-label row-label--link">
                <UIcon
                  :name="showTelemetryDetails ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                  class="expand-icon"
                />
                What do we collect?
              </span>
            </div>
          </div>
          <div v-if="showTelemetryDetails" class="card-row-details">
            <p>When enabled, we collect only:</p>
            <ul>
              <li><strong>Adoption:</strong> Anonymous install ID, app version, OS, launch frequency.</li>
              <li><strong>Feature usage:</strong> Chat mode, worktree usage, flow presets used, model/effort selections.</li>
              <li><strong>Errors:</strong> Error type and sanitized message (no paths, no user data).</li>
            </ul>
            <p class="details-footer">We <strong>never</strong> collect project names, file contents, chat content, API keys, or any personally identifiable information.</p>

            <template v-if="telemetryEnabled">
              <div class="install-id-section">
                <span class="row-desc">Install ID:</span>
                <code class="install-id-value">{{ maskedInstallId }}</code>
                <UButton
                  v-if="telemetryInstallId"
                  variant="ghost"
                  color="neutral"
                  size="xs"
                  :icon="showInstallId ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                  @click.stop="showInstallId = !showInstallId"
                />
              </div>
              <UButton
                variant="outline"
                color="neutral"
                size="xs"
                icon="i-lucide-eye"
                @click.stop="showTelemetryData = true"
              >
                View Telemetry Data
              </UButton>
            </template>
          </div>
        </div>

        <UModal v-model:open="showTelemetryData">
          <template #content>
            <div class="telemetry-modal">
              <div class="telemetry-modal-header">
                <h3>Collected Telemetry Data</h3>
                <UButton variant="ghost" color="neutral" size="xs" icon="i-lucide-x" @click="showTelemetryData = false" />
              </div>
              <div v-if="telemetryEvents.length > 0" class="telemetry-modal-body">
                <pre class="telemetry-json">{{ JSON.stringify(telemetryEvents, null, 2) }}</pre>
              </div>
              <div v-else class="telemetry-modal-empty">
                <p v-if="!telemetryEnabled">Telemetry is disabled. No data is being collected.</p>
                <p v-else>No events collected yet this session.</p>
              </div>
            </div>
          </template>
        </UModal>
      </section>

      <!-- ═══ System ═══ -->
      <section class="section">
        <div class="section-header">
          <h2 class="section-title">System</h2>
          <p class="section-subtitle">Health, version, and diagnostics</p>
        </div>
        <div class="grouped-card">
          <!-- Dependencies header -->
          <div class="card-row card-row--header">
            <span class="row-label">Dependencies</span>
            <UButton
              variant="ghost"
              color="neutral"
              size="xs"
              icon="i-lucide-refresh-cw"
              :loading="healthLoading"
              @click="runHealthCheck"
            >
              Recheck
            </UButton>
          </div>

          <!-- Health items -->
          <template v-if="healthLoading && !healthData.length">
            <div class="card-row" v-for="i in 3" :key="i">
              <USkeleton class="h-4 w-24" />
              <USkeleton class="h-4 w-16" />
            </div>
          </template>
          <div v-else v-for="item in healthData" :key="item.label" class="card-row">
            <div class="row-info row-info--health">
              <div
                class="health-dot"
                :class="{
                  'health-dot--green': item.status === 'green',
                  'health-dot--amber': item.status === 'amber',
                  'health-dot--red': item.status === 'red',
                }"
              />
              <span class="row-label">{{ item.label }}</span>
            </div>
            <span class="row-value">{{ item.detail }}</span>
          </div>

          <!-- App info -->
          <div class="card-row">
            <span class="row-label">OnCraft</span>
            <span class="row-value mono">{{ appVersion }}</span>
          </div>
          <div class="card-row">
            <span class="row-label">License</span>
            <span class="row-value">FSL → Apache 2.0</span>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  height: 100%;
  overflow-y: auto;
  background: var(--bg-primary);
}

.settings-scroll {
  max-width: 520px;
  margin: 0 auto;
  padding: 32px 24px 48px;
}

/* Page header */
.page-header { margin-bottom: 28px; }
.page-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}
.page-subtitle {
  font-size: 12px;
  color: var(--text-muted);
  margin: 4px 0 0;
}

/* Sections */
.section { margin-bottom: 24px; }
.section-header { margin-bottom: 10px; }
.section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}
.section-subtitle {
  font-size: 11px;
  color: var(--text-muted);
  margin: 2px 0 0;
}

/* Grouped card */
.grouped-card {
  background: var(--bg-secondary);
  border-radius: 10px;
  border: 1px solid var(--border);
  overflow: hidden;
}

/* Card rows */
.card-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
}
.card-row:last-child { border-bottom: none; }

.card-row--header {
  padding: 10px 14px;
}

.card-row--expandable {
  cursor: pointer;
  transition: background 0.1s;
}
.card-row--expandable:hover {
  background: color-mix(in srgb, var(--bg-tertiary) 50%, transparent);
}

.card-row--chat-mode {
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
}

/* Row content */
.row-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.row-info--health {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}
.row-label {
  font-size: 12px;
  color: var(--text-primary);
}
.row-label--link {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--accent);
  font-size: 12px;
}
.row-desc {
  font-size: 10px;
  color: var(--text-muted);
}
.row-value {
  font-size: 11px;
  color: var(--text-secondary);
  flex-shrink: 0;
}
.row-control {
  flex-shrink: 0;
}

/* Theme pills */
.theme-pills {
  display: flex;
  background: var(--bg-tertiary);
  border-radius: 6px;
  padding: 2px;
  flex-shrink: 0;
}
.pill {
  padding: 4px 12px;
  border-radius: 5px;
  font-size: 11px;
  color: var(--text-muted);
  background: none;
  border: none;
  cursor: pointer;
  transition: all 0.15s;
}
.pill.active {
  background: var(--accent);
  color: var(--bg-primary);
  font-weight: 500;
}

/* Chat mode cards */
.chat-mode-options {
  display: flex;
  gap: 8px;
}
.chat-mode-card {
  flex: 1;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
  text-align: left;
}
.chat-mode-card:hover {
  border-color: var(--text-muted);
}
.chat-mode-card.active {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 6%, var(--bg-tertiary));
}
.chat-mode-icon {
  width: 16px;
  height: 16px;
  color: var(--text-muted);
  flex-shrink: 0;
  margin-top: 1px;
}
.chat-mode-card.active .chat-mode-icon {
  color: var(--accent);
}
.chat-mode-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.chat-mode-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
}
.chat-mode-desc {
  font-size: 10px;
  color: var(--text-muted);
  line-height: 1.4;
}

/* Expand icon */
.expand-icon {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
}

/* Telemetry details (inside card) */
.card-row-details {
  padding: 10px 14px 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.6;
}
.card-row-details p { margin: 0 0 6px; }
.card-row-details p:last-child { margin-bottom: 0; }
.card-row-details ul { margin: 0 0 6px; padding-left: 18px; }
.card-row-details li { margin-bottom: 3px; }
.details-footer { color: var(--text-muted); font-style: italic; }

.install-id-section {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px 0 6px;
}
.install-id-value {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 10px;
  color: var(--text-muted);
  background: var(--bg-tertiary);
  padding: 2px 6px;
  border-radius: 3px;
}

/* Health dots */
.health-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.health-dot--green { background: var(--success); }
.health-dot--amber { background: #fbbf24; }
.health-dot--red { background: var(--error); }

/* Mono */
.mono { font-family: 'SF Mono', 'Fira Code', monospace; }

/* Telemetry data modal */
.telemetry-modal { padding: 20px; }
.telemetry-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.telemetry-modal-header h3 {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}
.telemetry-modal-body { max-height: 400px; overflow-y: auto; }
.telemetry-json {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--bg-tertiary);
  padding: 12px;
  border-radius: 6px;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
}
.telemetry-modal-empty {
  text-align: center;
  padding: 24px;
  color: var(--text-muted);
  font-size: 13px;
}
.telemetry-modal-empty p { margin: 0; }
</style>
