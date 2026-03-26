<script setup lang="ts">
import { open } from '@tauri-apps/plugin-dialog'
import { preloadUtilSidecar } from '~/services/claude-process'
import { installBundledPresets } from '~/services/flow-loader'

// ME-5: Lazy-load heavy components that are not needed at startup.
// ChatPanel pulls in marked + hljs (~480KB), ConsolePanel pulls in xterm (~300KB).
// Settings dialogs are rarely opened.
const ChatPanel = defineAsyncComponent(() => import('~/components/ChatPanel.vue'))
const ConsolePanel = defineAsyncComponent(() => import('~/components/ConsolePanel.vue'))
const ProjectSettings = defineAsyncComponent(() => import('~/components/ProjectSettings.vue'))
const GlobalSettings = defineAsyncComponent(() => import('~/components/GlobalSettings.vue'))

const projectsStore = useProjectsStore()
const settingsStore = useSettingsStore()
const cardsStore = useCardsStore()
const pipelinesStore = usePipelinesStore()
const sessionsStore = useSessionsStore()
const { activeFile, closeFile } = useFileViewer()

const appReady = ref(false)
const showSettings = ref(false)
const showGlobalSettings = ref(false)
const showChat = computed(() => sessionsStore.activeChatCardId !== null)
const isConsoleMode = computed(() => settingsStore.settings.chatMode === 'console')
const chatWidth = ref(400)
const consoleWidth = ref(520)

async function addProject() {
  try {
    const selected = await open({ directory: true, multiple: false })
    if (!selected) return
    const path = typeof selected === 'string' ? selected : String(selected)
    const name = path.split('/').filter(Boolean).pop() || 'project'
    const project = await projectsStore.addProject(name, path)
    await cardsStore.loadForProject(project.id)
    await pipelinesStore.loadForProject(project.path)
  } catch (err) {
    console.error('[OnCraft] addProject error:', err)
  }
}

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

  if (projectsStore.activeProject) {
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

  appReady.value = true
})
</script>

<template>
  <UApp>
    <!-- Splash screen during initialization -->
    <Transition name="splash-fade">
      <AppSplash v-if="!appReady" />
    </Transition>

    <div v-show="appReady" id="app">
      <TabBar @open-settings="showSettings = true" @open-global-settings="showGlobalSettings = true" />
      <div class="main-content" :class="{ 'with-chat': showChat }">
        <div class="board-area">
          <ErrorBoundary>
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
      <GlobalSettings v-if="showGlobalSettings" v-model:open="showGlobalSettings" @close="showGlobalSettings = false" />
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
