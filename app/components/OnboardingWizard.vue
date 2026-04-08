<script setup lang="ts">
import { runHealthChecks, type HealthCheckResult } from '~/services/health-check'
import { setEnabled as telemetrySetEnabled } from '~/services/telemetry'
import type { StepperItem } from '@nuxt/ui'

const emit = defineEmits<{
  complete: []
}>()

const settingsStore = useSettingsStore()
const { addProject } = useProjectActions()

const currentStep = ref(0)
const telemetryChecked = ref(false)
const healthResult = ref<HealthCheckResult | null>(null)
const healthLoading = ref(false)
const stepperItems: StepperItem[] = [
  { title: 'Welcome', icon: 'i-lucide-layers' },
  { title: 'Checks', icon: 'i-lucide-shield-check' },
  { title: 'Project', icon: 'i-lucide-folder-open' },
]

async function runChecks() {
  healthLoading.value = true
  try {
    healthResult.value = await runHealthChecks()
  } catch (err) {
    if (import.meta.dev) console.error('[OnCraft] onboarding health check failed:', err)
  } finally {
    healthLoading.value = false
  }
}

function nextStep() {
  if (currentStep.value === 0) {
    // Wire telemetry preference through the service (creates install ID on opt-in)
    telemetrySetEnabled(telemetryChecked.value)
    // Start health checks for Step 2
    runChecks()
  }
  if (currentStep.value < 2) {
    currentStep.value++
  }
}

function prevStep() {
  if (currentStep.value > 0) {
    currentStep.value--
  }
}

async function dismiss() {
  settingsStore.settings.onboardingDismissed = true
  await settingsStore.save()
  emit('complete')
}

async function finish() {
  settingsStore.settings.onboardingCompleted = true
  telemetrySetEnabled(telemetryChecked.value)
  await settingsStore.save()
  emit('complete')
}

async function openProjectAndFinish() {
  await addProject()
  await finish()
}
</script>

<template>
  <div class="onboarding-overlay">
    <div class="onboarding-card">
      <!-- Step indicators -->
      <UStepper
        :model-value="currentStep"
        :items="stepperItems"
        size="xs"
        color="primary"
        disabled
      />

      <!-- Step 1: Welcome -->
      <div v-if="currentStep === 0" class="step-content">
        <UIcon name="i-lucide-layers" class="step-hero-icon" />
        <h2 class="step-title">Welcome to OnCraft</h2>
        <p class="step-description">
          OnCraft helps you manage Claude Code sessions with a Kanban board.
          Each card is a conversation that flows through your development workflow.
        </p>

        <label class="telemetry-label">
          <UCheckbox v-model="telemetryChecked" />
          <span class="telemetry-text">
            Help improve OnCraft by sharing anonymous usage data
          </span>
        </label>
        <p class="telemetry-hint">
          No personal data, file contents, or chat messages are ever collected.
          You can change this in Settings at any time.
        </p>
      </div>

      <!-- Step 2: Prerequisite Check -->
      <div v-if="currentStep === 1" class="step-content">
        <UIcon name="i-lucide-shield-check" class="step-hero-icon" />
        <h2 class="step-title">Prerequisite Check</h2>
        <p class="step-description">
          OnCraft needs a few tools installed to work. Here's what we found:
        </p>

        <div v-if="healthResult" class="health-check-list">
          <div v-for="item in healthResult.items" :key="item.label" class="health-check-row">
            <div class="health-check-dot" :class="`health-check-dot--${item.status}`" />
            <div class="health-check-info">
              <span class="health-check-name">{{ item.label }}</span>
              <span class="health-check-detail">{{ item.detail }}</span>
              <span v-if="item.hint && item.status !== 'green'" class="health-check-hint">{{ item.hint }}</span>
            </div>
          </div>
        </div>
        <div v-else-if="healthLoading" class="checking-text">
          Checking prerequisites...
        </div>

        <UButton
          variant="ghost"
          color="neutral"
          size="xs"
          icon="i-lucide-refresh-cw"
          :loading="healthLoading"
          class="recheck-btn"
          @click="runChecks"
        >
          Check again
        </UButton>

        <p class="step-hint">
          Warnings are non-blocking — you can continue and install missing tools later.
        </p>
      </div>

      <!-- Step 3: Open First Project -->
      <div v-if="currentStep === 2" class="step-content">
        <UIcon name="i-lucide-folder-open" class="step-hero-icon" />
        <h2 class="step-title">Open Your First Project</h2>
        <p class="step-description">
          A project is a code repository. OnCraft will create a
          <code>.oncraft/</code> folder for its configuration.
        </p>

        <UButton
          color="primary"
          size="md"
          icon="i-lucide-folder-open"
          class="open-project-btn"
          @click="openProjectAndFinish"
        >
          Open project folder
        </UButton>

        <UButton
          variant="ghost"
          color="neutral"
          size="sm"
          class="skip-btn"
          @click="finish"
        >
          Skip for now
        </UButton>
      </div>

      <!-- Navigation buttons -->
      <div class="step-nav">
        <UButton
          v-if="currentStep > 0"
          variant="ghost"
          color="neutral"
          size="sm"
          @click="prevStep"
        >
          Back
        </UButton>
        <div class="nav-spacer" />
        <UButton
          variant="link"
          color="neutral"
          size="xs"
          @click="dismiss"
        >
          Don't show again
        </UButton>
        <UButton
          v-if="currentStep < 2"
          color="primary"
          size="sm"
          @click="nextStep"
        >
          Continue
        </UButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.onboarding-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
}

.onboarding-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 14px;
  width: 460px;
  max-width: 90vw;
  padding: 28px 32px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* Step content */
.step-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 10px;
}
.step-hero-icon {
  width: 40px;
  height: 40px;
  color: var(--accent);
  margin-bottom: 4px;
}
.step-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}
.step-description {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.6;
  max-width: 380px;
}
.step-description code {
  background: var(--bg-tertiary);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 12px;
}
.step-hint {
  font-size: 11px;
  color: var(--text-muted);
  margin: 4px 0 0;
}

/* Telemetry */
.telemetry-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  cursor: pointer;
}
.telemetry-text {
  font-size: 13px;
  color: var(--text-primary);
}
.telemetry-hint {
  font-size: 11px;
  color: var(--text-muted);
  margin: 2px 0 0;
  max-width: 340px;
  line-height: 1.5;
}

/* Health check list */
.health-check-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  max-width: 320px;
  margin-top: 8px;
}
.health-check-row {
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
}
.health-check-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.health-check-dot--green { background: var(--success); }
.health-check-dot--amber { background: var(--warning); }
.health-check-dot--red { background: var(--error); }
.health-check-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.health-check-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.health-check-detail {
  font-size: 11px;
  color: var(--text-muted);
}
.health-check-hint {
  font-size: 11px;
  color: var(--accent);
  font-style: italic;
}
.checking-text {
  font-size: 13px;
  color: var(--text-muted);
  padding: 16px 0;
}
.recheck-btn { margin-top: 4px; }

/* Open project */
.open-project-btn { margin-top: 12px; }
.skip-btn { margin-top: 4px; }

/* Navigation */
.step-nav {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 4px;
  border-top: 1px solid var(--border);
}
.nav-spacer { flex: 1; }
</style>
