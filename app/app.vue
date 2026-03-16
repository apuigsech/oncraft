<script setup lang="ts">
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
  try {
    await settingsStore.load()
    console.log('[ClaudBan] settings loaded')
  } catch (err) {
    console.warn('[ClaudBan] settings load failed, using defaults:', err)
  }
  try {
    await projectsStore.load()
    console.log('[ClaudBan] projects loaded:', projectsStore.projects.length, 'projects, active:', projectsStore.activeProjectId)
    if (projectsStore.activeProject) {
      await cardsStore.loadForProject(projectsStore.activeProject.id)
      await pipelinesStore.loadForProject(projectsStore.activeProject.path)
      sessionsStore.loadAvailableCommands(projectsStore.activeProject.path)
      console.log('[ClaudBan] active project loaded:', projectsStore.activeProject.name)
    }
  } catch (err) {
    console.error('[ClaudBan] project load error:', err)
  }
})
</script>

<template>
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
