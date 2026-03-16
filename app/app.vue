<script setup lang="ts">
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

const showSettings = ref(false)
const showGlobalSettings = ref(false)
const showChat = computed(() => sessionsStore.activeChatCardId !== null)
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
  // QW-1: Parallel store loads — settings and projects are independent
  const [settingsResult, projectsResult] = await Promise.allSettled([
    settingsStore.load(),
    projectsStore.load(),
  ])

  if (settingsResult.status === 'rejected') {
    if (import.meta.dev) console.warn('[ClaudBan] settings load failed, using defaults:', settingsResult.reason)
  }
  if (projectsResult.status === 'rejected') {
    if (import.meta.dev) console.error('[ClaudBan] project load error:', projectsResult.reason)
    return
  }

  if (projectsStore.activeProject) {
    // QW-1: Cards and pipelines are independent — load in parallel
    await Promise.allSettled([
      cardsStore.loadForProject(projectsStore.activeProject.id),
      pipelinesStore.loadForProject(projectsStore.activeProject.path),
    ])
    // QW-2: loadAvailableCommands deferred — will load on first chat open
    // DA-1: listCommands is now a native Rust command, no sidecar preload needed
  }
})
</script>

<template>
  <UApp>
    <div id="app">
      <TabBar @open-settings="showSettings = true" @open-global-settings="showGlobalSettings = true" />
      <div class="main-content" :class="{ 'with-chat': showChat }">
        <div class="board-area">
          <KanbanBoard v-if="projectsStore.activeProject" />
          <div v-else class="empty-state">
            <p>Add a project to get started</p>
          </div>
        </div>
        <div v-if="showChat" class="divider" @mousedown="startResize" />
        <ConsolePanel v-if="showChat && isConsoleMode" :style="{ width: consoleWidth + 'px' }" />
        <ChatPanel v-else-if="showChat" :style="{ width: chatWidth + 'px' }" />
      </div>
      <ProjectSettings v-if="showSettings" @close="showSettings = false" />
      <GlobalSettings v-if="showGlobalSettings" @close="showGlobalSettings = false" />
    </div>
  </UApp>
</template>

<style scoped>
#app { height: 100vh; display: flex; flex-direction: column; }
.main-content { flex: 1; display: flex; overflow: hidden; }
.board-area { flex: 1; overflow-x: auto; overflow-y: hidden; }
.empty-state {
  display: flex; align-items: center; justify-content: center;
  height: 100%; color: var(--text-muted); font-size: 1.1rem;
}
.divider { width: 4px; cursor: col-resize; background: var(--border); transition: background 0.15s; }
.divider:hover { background: var(--accent); }
</style>
