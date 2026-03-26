<script setup lang="ts">
import { preloadUtilSidecar } from '~/services/claude-process'
import { installBundledPresets } from '~/services/flow-loader'
import { initTelemetry, shutdownTelemetry } from '~/services/telemetry'

// ME-5: Lazy-load heavy components that are not needed at startup.
// ChatPanel pulls in marked + hljs (~480KB), ConsolePanel pulls in xterm (~300KB).
// Settings dialogs are rarely opened.
const ChatPanel = defineAsyncComponent(() => import('~/components/ChatPanel.vue'))
const ConsolePanel = defineAsyncComponent(() => import('~/components/ConsolePanel.vue'))
const ProjectSettings = defineAsyncComponent(() => import('~/components/ProjectSettings.vue'))
const GlobalSettingsPage = defineAsyncComponent(() => import('~/components/GlobalSettingsPage.vue'))

const projectsStore = useProjectsStore()
const settingsStore = useSettingsStore()
const cardsStore = useCardsStore()
const pipelinesStore = usePipelinesStore()
const sessionsStore = useSessionsStore()
const { activeFile, closeFile } = useFileViewer()
const { addProject } = useProjectActions()

const appReady = ref(false)
const showOnboarding = ref(false)

// NAV: activeTab lives in projectsStore so sessions store can derive per-project chat correctly
const { activeTab, isProjectTab } = storeToRefs(projectsStore)

const showSettings = ref(false)
const showChat = computed(() => isProjectTab.value && sessionsStore.activeChatCardId !== null)
const isConsoleMode = computed(() => settingsStore.settings.chatMode === 'console')
const chatWidth = ref(400)
const consoleWidth = ref(520)

function startResize(e: MouseEvent) {
  const startX = e.clientX
  const isConsole = isConsoleMode.value
  const startWidth = isConsole ? consoleWidth.value : chatWidth.value
  const maxW = isConsole ? 1000 : 600
  const minW = 320
  function onMouseMove(ev: MouseEvent) {
    const newWidth = Math.max(minW, Math.min(maxW, startWidth - (ev.clientX - startX)))
    if (isConsole) {
      consoleWidth.value = newWidth
    } else {
      chatWidth.value = newWidth
    }
  }
  function onMouseUp() {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

onMounted(async () => {
  // Install bundled presets to ~/.oncraft/presets/ on first launch (idempotent)
  installBundledPresets()

  // QW-1: Parallel store loads — settings and projects are independent
  const [settingsResult, projectsResult] = await Promise.allSettled([
    settingsStore.load(),
    projectsStore.load(),
  ])

  if (settingsResult.status === 'rejected') {
    if (import.meta.dev) console.warn('[OnCraft] settings load failed, using defaults:', settingsResult.reason)
  }
  if (projectsResult.status === 'rejected') {
    if (import.meta.dev) console.error('[OnCraft] project load error:', projectsResult.reason)
    appReady.value = true
    return
  }

  // NAV: Set initial tab to active project or home
  if (projectsStore.activeProject) {
    projectsStore.activeTab = projectsStore.activeProject.id
    // QW-1: Cards and pipelines are independent — load in parallel
    await Promise.allSettled([
      cardsStore.loadForProject(projectsStore.activeProject.id),
      pipelinesStore.loadForProject(projectsStore.activeProject.path),
    ])
    // QW-2: loadAvailableCommands deferred — will load on first chat open
    // Preload utility sidecar in background so history loads are fast
    // when the user opens a chat (sidecar is only needed for SDK operations)
    preloadUtilSidecar()
  }

  // Initialize telemetry after settings are loaded (tracks launch if opted in)
  initTelemetry()

  // Show onboarding on first launch
  const s = settingsStore.settings
  if (!s.onboardingCompleted && !s.onboardingDismissed) {
    showOnboarding.value = true
  }

  appReady.value = true
})

onUnmounted(() => {
  shutdownTelemetry()
})
</script>

<template>
  <UApp>
    <!-- Splash screen during initialization -->
    <Transition name="splash-fade">
      <AppSplash v-if="!appReady" />
    </Transition>

    <div v-show="appReady" id="app">
      <TabBar @open-project-settings="showSettings = true" />
      <div class="main-content" :class="{ 'with-chat': showChat }">
        <div class="board-area">
          <ErrorBoundary>
            <!-- Home tab -->
            <HomeScreen v-if="activeTab === 'home'" />

            <!-- Settings tab (full-screen) -->
            <GlobalSettingsPage
              v-else-if="activeTab === 'settings'"
            />

            <!-- Project tab: file viewer, kanban, or empty state -->
            <template v-else>
              <FileViewer
                v-if="activeFile && projectsStore.activeProject"
                :label="activeFile.label"
                :file-path="activeFile.path"
                :project-path="projectsStore.activeProject.path"
                @close="closeFile()"
              />
              <KanbanBoard v-else-if="projectsStore.activeProject" />
              <EmptyState
                v-else
                icon="i-lucide-folder-open"
                title="No project open"
                description="Open a project folder to start managing your Claude Code sessions."
                action-label="Open project"
                action-icon="i-lucide-plus"
                @action="addProject"
              />
            </template>
          </ErrorBoundary>
        </div>
        <Transition name="chat-slide">
          <div v-if="showChat" class="chat-side">
            <div class="divider" @mousedown="startResize" />
            <ErrorBoundary v-if="isConsoleMode">
              <ConsolePanel :style="{ width: consoleWidth + 'px' }" />
            </ErrorBoundary>
            <ErrorBoundary v-else>
              <ChatPanel :style="{ width: chatWidth + 'px' }" />
            </ErrorBoundary>
          </div>
        </Transition>
      </div>
      <ProjectSettings v-if="showSettings" v-model:open="showSettings" @close="showSettings = false" />

      <!-- Onboarding wizard on first launch -->
      <OnboardingWizard v-if="showOnboarding" @complete="showOnboarding = false" />
    </div>
  </UApp>
</template>

<style scoped>
#app { height: 100vh; display: flex; flex-direction: column; }
.main-content { flex: 1; display: flex; overflow: hidden; }
.board-area { flex: 1; overflow-x: auto; overflow-y: hidden; }
.chat-side { display: flex; flex-shrink: 0; }
.divider { width: 4px; cursor: col-resize; background: var(--border); transition: background 0.15s; }
.divider:hover { background: var(--accent); }

/* Splash fade-out transition */
.splash-fade-leave-active { transition: opacity 0.3s ease; }
.splash-fade-leave-to { opacity: 0; }

/* Chat panel slide-in/out transition */
.chat-slide-enter-active { transition: transform 0.25s ease-out, opacity 0.25s ease-out; }
.chat-slide-leave-active { transition: transform 0.2s ease-in, opacity 0.2s ease-in; }
.chat-slide-enter-from { transform: translateX(100%); opacity: 0; }
.chat-slide-leave-to { transform: translateX(100%); opacity: 0; }
</style>
