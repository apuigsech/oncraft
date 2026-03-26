<script setup lang="ts">
import type { ChatMode, ModelAlias, EffortLevel } from '~/types';
import type { HealthCheckItem } from '~/services/health-check';

const settingsStore = useSettingsStore();

// Section navigation
const sections = [
  { id: 'general', label: 'General', icon: 'i-lucide-sliders-horizontal' },
  { id: 'telemetry', label: 'Telemetry', icon: 'i-lucide-bar-chart-3' },
  { id: 'system', label: 'System', icon: 'i-lucide-monitor-check' },
  { id: 'about', label: 'About', icon: 'i-lucide-info' },
] as const;

type SectionId = (typeof sections)[number]['id'];
const activeSection = ref<SectionId>('general');

// ── General section ──
const selectedTheme = computed({
  get: () => settingsStore.settings.theme || 'dark',
  set: (val: 'dark' | 'light') => {
    settingsStore.settings.theme = val;
    settingsStore.save();
  },
});

const chatModeOptions = [
  { label: 'Integrated UI', value: 'integrated' as ChatMode, description: 'Rich chat with markdown, tool blocks, and metrics', icon: 'i-lucide-message-square' },
  { label: 'Console (Terminal)', value: 'console' as ChatMode, description: 'Full Claude CLI running in an embedded terminal', icon: 'i-lucide-terminal' },
];

const modelOptions = [
  { label: 'Opus', value: 'opus' as ModelAlias },
  { label: 'Sonnet', value: 'sonnet' as ModelAlias },
  { label: 'Haiku', value: 'haiku' as ModelAlias },
];

const effortOptions = [
  { label: 'Low', value: 'low' as EffortLevel },
  { label: 'Medium', value: 'medium' as EffortLevel },
  { label: 'High', value: 'high' as EffortLevel },
  { label: 'Max', value: 'max' as EffortLevel },
];

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

// ── Telemetry section ──
const telemetryEnabled = computed({
  get: () => settingsStore.settings.telemetryEnabled ?? false,
  set: (val: boolean) => {
    settingsStore.settings.telemetryEnabled = val;
    settingsStore.save();
  },
});
const showTelemetryDetails = ref(false);

// ── System section ──
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

// ── About section ──
const appVersion = import.meta.env.PACKAGE_VERSION ?? 'dev';
</script>

<template>
  <div class="settings-page">
    <!-- Sidebar -->
    <nav class="settings-sidebar">
      <div class="sidebar-header">
        <UIcon name="i-lucide-settings" class="sidebar-header-icon" />
        <span class="sidebar-title">Settings</span>
      </div>
      <ul class="sidebar-nav">
        <li
          v-for="s in sections"
          :key="s.id"
          class="sidebar-item"
          :class="{ active: activeSection === s.id }"
          @click="activeSection = s.id"
        >
          <UIcon :name="s.icon" class="sidebar-icon" />
          <span>{{ s.label }}</span>
        </li>
      </ul>
    </nav>

    <!-- Main content -->
    <div class="settings-main">
      <div class="settings-content">
        <!-- General -->
        <section v-if="activeSection === 'general'" class="section">
          <h2 class="section-title">General</h2>

          <!-- Theme -->
          <div class="setting-group">
            <span class="setting-label">Theme</span>
            <div class="option-pills">
              <UButton
                size="sm"
                :variant="selectedTheme === 'dark' ? 'solid' : 'ghost'"
                :color="selectedTheme === 'dark' ? 'primary' : 'neutral'"
                icon="i-lucide-moon"
                @click="selectedTheme = 'dark'"
              >
                Dark
              </UButton>
              <UButton
                size="sm"
                :variant="selectedTheme === 'light' ? 'solid' : 'ghost'"
                :color="selectedTheme === 'light' ? 'primary' : 'neutral'"
                icon="i-lucide-sun"
                @click="selectedTheme = 'light'"
              >
                Light
              </UButton>
            </div>
            <p class="hint">Light theme is not yet fully implemented.</p>
          </div>

          <!-- Chat Mode -->
          <div class="setting-group">
            <span class="setting-label">Chat Mode</span>
            <div class="chat-mode-options">
              <UButton
                v-for="opt in chatModeOptions"
                :key="opt.value"
                :variant="selectedChatMode === opt.value ? 'outline' : 'ghost'"
                :color="selectedChatMode === opt.value ? 'primary' : 'neutral'"
                class="mode-option"
                :class="{ active: selectedChatMode === opt.value }"
                @click="selectedChatMode = opt.value"
              >
                <template #leading>
                  <UIcon :name="opt.icon" class="mode-icon" />
                </template>
                <div class="mode-content">
                  <span class="mode-label">{{ opt.label }}</span>
                  <span class="mode-desc">{{ opt.description }}</span>
                </div>
              </UButton>
            </div>
            <p class="hint">Claude agent is bundled with the application. Console mode requires the Claude CLI to be installed.</p>
          </div>

          <!-- Default Model -->
          <div class="setting-group">
            <span class="setting-label">Default Model</span>
            <div class="option-pills">
              <UButton
                v-for="opt in modelOptions"
                :key="opt.value"
                size="sm"
                :variant="selectedModel === opt.value ? 'solid' : 'ghost'"
                :color="selectedModel === opt.value ? 'primary' : 'neutral'"
                @click="selectedModel = opt.value"
              >
                {{ opt.label }}
              </UButton>
            </div>
            <p class="hint">Default model for new sessions. Can be overridden per card.</p>
          </div>

          <!-- Default Effort -->
          <div class="setting-group">
            <span class="setting-label">Default Effort Level</span>
            <div class="option-pills">
              <UButton
                v-for="opt in effortOptions"
                :key="opt.value"
                size="sm"
                :variant="selectedEffort === opt.value ? 'solid' : 'ghost'"
                :color="selectedEffort === opt.value ? 'primary' : 'neutral'"
                @click="selectedEffort = opt.value"
              >
                {{ opt.label }}
              </UButton>
            </div>
            <p class="hint">Default effort level for new sessions. Can be overridden per card.</p>
          </div>
        </section>

        <!-- Telemetry -->
        <section v-if="activeSection === 'telemetry'" class="section">
          <h2 class="section-title">Telemetry</h2>

          <div class="setting-group">
            <div class="toggle-row">
              <div>
                <span class="setting-label">Anonymous Usage Data</span>
                <p class="hint">Help improve the app by sharing anonymous usage statistics.</p>
              </div>
              <USwitch v-model="telemetryEnabled" />
            </div>
          </div>

          <div class="setting-group">
            <UButton
              variant="ghost"
              color="neutral"
              size="sm"
              :icon="showTelemetryDetails ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
              @click="showTelemetryDetails = !showTelemetryDetails"
            >
              What do we collect?
            </UButton>
            <div v-if="showTelemetryDetails" class="telemetry-details">
              <p>When enabled, we collect only:</p>
              <ul>
                <li><strong>Adoption:</strong> Anonymous install ID, app version, OS, launch frequency.</li>
                <li><strong>Feature usage:</strong> Chat mode, worktree usage, flow presets used, model/effort selections.</li>
                <li><strong>Errors:</strong> Error type and sanitized message (no paths, no user data).</li>
              </ul>
              <p class="details-footer">We <strong>never</strong> collect project names, file contents, chat content, API keys, or any personally identifiable information.</p>
            </div>
          </div>

          <div class="setting-group">
            <UButton
              variant="outline"
              color="neutral"
              size="sm"
              icon="i-lucide-eye"
              disabled
            >
              View Telemetry Data
            </UButton>
            <p class="hint">Coming soon: inspect exactly what data is being collected.</p>
          </div>
        </section>

        <!-- System -->
        <section v-if="activeSection === 'system'" class="section">
          <h2 class="section-title">System</h2>

          <div class="setting-group">
            <div class="health-header">
              <span class="setting-label">Prerequisite Status</span>
              <UButton
                variant="ghost"
                color="neutral"
                size="xs"
                icon="i-lucide-refresh-cw"
                :loading="healthLoading"
                @click="runHealthCheck"
              >
                Check again
              </UButton>
            </div>

            <div v-if="healthLoading && !healthData.length" class="health-loading">
              <USkeleton class="h-4 w-full" />
              <USkeleton class="h-4 w-3/4" />
              <USkeleton class="h-4 w-5/6" />
            </div>
            <div v-else class="health-list">
              <div v-for="item in healthData" :key="item.label" class="health-item">
                <UIcon
                  :name="item.status === 'green' ? 'i-lucide-check-circle' : item.status === 'amber' ? 'i-lucide-alert-triangle' : 'i-lucide-x-circle'"
                  :class="['health-icon', `health-${item.status}`]"
                />
                <div class="health-info">
                  <span class="health-label">{{ item.label }}</span>
                  <span class="health-detail">{{ item.detail }}</span>
                  <span v-if="item.hint" class="health-hint">{{ item.hint }}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- About -->
        <section v-if="activeSection === 'about'" class="section">
          <h2 class="section-title">About</h2>

          <div class="about-grid">
            <div class="about-item">
              <span class="about-label">Version</span>
              <span class="about-value mono">{{ appVersion }}</span>
            </div>
            <div class="about-item">
              <span class="about-label">License</span>
              <span class="about-value">FSL (Functional Source License), converting to Apache 2.0 after 2 years</span>
            </div>
          </div>

          <div class="about-links">
            <UButton variant="outline" color="neutral" size="sm" icon="i-lucide-file-text" disabled>
              Changelog
            </UButton>
            <UButton variant="outline" color="neutral" size="sm" icon="i-lucide-download" disabled>
              Download Page
            </UButton>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  display: flex;
  height: 100%;
  background: var(--bg-primary);
}

/* Sidebar */
.settings-sidebar {
  width: 220px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  background: var(--bg-secondary);
  display: flex;
  flex-direction: column;
  padding: 20px 0;
}
.sidebar-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 20px 16px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 8px;
}
.sidebar-header-icon { font-size: 20px; color: var(--text-secondary); }
.sidebar-title { font-size: 16px; font-weight: 700; color: var(--text-primary); }

.sidebar-nav {
  list-style: none;
  margin: 0;
  padding: 4px 8px;
}
.sidebar-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.sidebar-item:hover { background: var(--bg-tertiary); color: var(--text-primary); }
.sidebar-item.active { background: color-mix(in srgb, var(--accent) 15%, var(--bg-tertiary)); color: var(--accent); font-weight: 600; }
.sidebar-icon { width: 16px; height: 16px; flex-shrink: 0; }

/* Main */
.settings-main {
  flex: 1;
  overflow-y: auto;
  padding: 32px 40px;
}
.settings-content {
  max-width: 600px;
}

.section { display: flex; flex-direction: column; gap: 20px; }
.section-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 4px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}

.setting-group { display: flex; flex-direction: column; gap: 8px; }
.setting-label { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.hint { font-size: 12px; color: var(--text-muted); margin: 0; }

/* Chat mode buttons */
.chat-mode-options { display: flex; gap: 10px; }
.mode-option {
  flex: 1;
  height: auto !important;
  padding: 12px !important;
  display: flex !important;
  flex-direction: column !important;
  align-items: flex-start !important;
  gap: 6px !important;
  text-align: left;
}
.mode-option.active { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--bg-primary)); }
.mode-icon { width: 18px; height: 18px; }
.mode-content { display: flex; flex-direction: column; gap: 4px; }
.mode-label { font-size: 13px; font-weight: 600; }
.mode-desc { font-size: 11px; color: var(--text-muted); line-height: 1.4; }

/* Option pills */
.option-pills { display: flex; gap: 6px; }

/* Toggle row */
.toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }

/* Telemetry details */
.telemetry-details {
  padding: 12px 16px;
  background: var(--bg-secondary);
  border-radius: 8px;
  border: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.6;
}
.telemetry-details p { margin: 0 0 8px; }
.telemetry-details p:last-child { margin-bottom: 0; }
.telemetry-details ul { margin: 0 0 8px; padding-left: 20px; }
.telemetry-details li { margin-bottom: 4px; }
.details-footer { color: var(--text-muted); font-style: italic; }

/* Health check */
.health-header { display: flex; align-items: center; justify-content: space-between; }
.health-loading { display: flex; flex-direction: column; gap: 8px; }
.health-list { display: flex; flex-direction: column; gap: 8px; }
.health-item { display: flex; align-items: flex-start; gap: 10px; padding: 8px 12px; background: var(--bg-secondary); border-radius: 6px; }
.health-icon { width: 18px; height: 18px; flex-shrink: 0; margin-top: 1px; }
.health-green { color: var(--success); }
.health-amber { color: #fbbf24; }
.health-red { color: var(--error); }
.health-info { display: flex; flex-direction: column; gap: 2px; }
.health-label { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.health-detail { font-size: 12px; color: var(--text-secondary); }
.health-hint { font-size: 11px; color: var(--text-muted); font-style: italic; }

/* About */
.about-grid { display: flex; flex-direction: column; gap: 12px; }
.about-item { display: flex; flex-direction: column; gap: 4px; }
.about-label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
.about-value { font-size: 13px; color: var(--text-secondary); }
.mono { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px; }
.about-links { display: flex; gap: 8px; margin-top: 4px; }
</style>
