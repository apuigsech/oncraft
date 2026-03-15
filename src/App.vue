<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useProjectsStore } from './stores/projects';
import { useSettingsStore } from './stores/settings';
import { useCardsStore } from './stores/cards';
import { usePipelinesStore } from './stores/pipelines';
import { useSessionsStore } from './stores/sessions';
import TabBar from './components/TabBar.vue';
import KanbanBoard from './components/KanbanBoard.vue';
import ChatPanel from './components/ChatPanel.vue';
import ProjectSettings from './components/ProjectSettings.vue';
import GlobalSettings from './components/GlobalSettings.vue';

const projectsStore = useProjectsStore();
const settingsStore = useSettingsStore();
const cardsStore = useCardsStore();
const pipelinesStore = usePipelinesStore();
const sessionsStore = useSessionsStore();

const showSettings = ref(false);
const showGlobalSettings = ref(false);
const showChat = computed(() => sessionsStore.activeChatCardId !== null);
const chatWidth = ref(400);

function startResize(e: MouseEvent) {
  const startX = e.clientX;
  const startWidth = chatWidth.value;
  function onMouseMove(ev: MouseEvent) {
    chatWidth.value = Math.max(320, Math.min(600, startWidth - (ev.clientX - startX)));
  }
  function onMouseUp() {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}

onMounted(async () => {
  await settingsStore.load();
  await projectsStore.load();
  if (projectsStore.activeProject) {
    await cardsStore.loadForProject(projectsStore.activeProject.id);
    await pipelinesStore.loadForProject(projectsStore.activeProject.path);
  }
});
</script>

<template>
  <TabBar @open-settings="showSettings = true" @open-global-settings="showGlobalSettings = true" />
  <div class="main-content" :class="{ 'with-chat': showChat }">
    <div class="board-area">
      <KanbanBoard v-if="projectsStore.activeProject" />
      <div v-else class="empty-state">
        <p>Add a project to get started</p>
      </div>
    </div>
    <div v-if="showChat" class="divider" @mousedown="startResize" />
    <ChatPanel v-if="showChat" :style="{ width: chatWidth + 'px' }" />
  </div>
  <ProjectSettings v-if="showSettings" @close="showSettings = false" />
  <GlobalSettings v-if="showGlobalSettings" @close="showGlobalSettings = false" />
</template>

<style scoped>
.main-content { flex: 1; display: flex; overflow: hidden; }
.board-area { flex: 1; overflow-x: auto; overflow-y: hidden; }
.empty-state {
  display: flex; align-items: center; justify-content: center;
  height: 100%; color: var(--text-muted); font-size: 1.1rem;
}
.divider { width: 4px; cursor: col-resize; background: var(--border); transition: background 0.15s; }
.divider:hover { background: var(--accent); }
</style>
