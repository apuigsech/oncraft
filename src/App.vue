<script setup lang="ts">
import { onMounted, computed } from 'vue';
import { useProjectsStore } from './stores/projects';
import { useSettingsStore } from './stores/settings';
import { useCardsStore } from './stores/cards';
import { usePipelinesStore } from './stores/pipelines';
import { useSessionsStore } from './stores/sessions';
import TabBar from './components/TabBar.vue';

const projectsStore = useProjectsStore();
const settingsStore = useSettingsStore();
const cardsStore = useCardsStore();
const pipelinesStore = usePipelinesStore();
const sessionsStore = useSessionsStore();

const showChat = computed(() => sessionsStore.activeChatCardId !== null);

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
  <TabBar />
  <div class="main-content" :class="{ 'with-chat': showChat }">
    <div class="board-area">
      <div v-if="!projectsStore.activeProject" class="empty-state">
        <p>Add a project to get started</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.main-content { flex: 1; display: flex; overflow: hidden; }
.board-area { flex: 1; overflow-x: auto; overflow-y: hidden; }
.empty-state {
  display: flex; align-items: center; justify-content: center;
  height: 100%; color: var(--text-muted); font-size: 1.1rem;
}
</style>
