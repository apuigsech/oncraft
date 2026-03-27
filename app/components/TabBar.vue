<script setup lang="ts">
import { VueDraggable } from 'vue-draggable-plus';
import type { Project } from '~/types';

const projectsStore = useProjectsStore();
const sessionsStore = useSessionsStore();
const { addProject, switchToProject, closeProject } = useProjectActions();

const emit = defineEmits<{ 'open-project-settings': [] }>();

// Local mutable copy for vue-draggable-plus (it needs to mutate the array during drag)
const draggableProjects = ref<Project[]>([]);
let syncing = false;
watch(() => projectsStore.projects, (newProjects) => {
  if (syncing) return;
  draggableProjects.value = [...newProjects];
}, { immediate: true });

async function onDragEnd() {
  syncing = true;
  try {
    const orderedIds = draggableProjects.value.map(p => p.id);
    await projectsStore.reorderProjects(orderedIds);
  } finally {
    syncing = false;
    draggableProjects.value = [...projectsStore.projects];
  }
}
</script>

<template>
  <div class="tab-bar">
    <!-- Pinned: Home tab -->
    <div
      class="tab tab--pinned"
      :class="{ 'tab--active': projectsStore.activeTab === 'home' }"
      @click="projectsStore.activeTab = 'home'"
      title="Home"
    >
      <UIcon name="i-lucide-house" class="tab-icon" />
    </div>

    <!-- Pinned: Settings tab -->
    <div
      class="tab tab--pinned"
      :class="{ 'tab--active': projectsStore.activeTab === 'settings' }"
      @click="projectsStore.activeTab = 'settings'"
      title="Settings"
    >
      <UIcon name="i-lucide-settings" class="tab-icon" />
    </div>

    <!-- Project tabs (draggable) -->
    <VueDraggable
      v-model="draggableProjects"
      class="project-tabs"
      :animation="150"
      :force-fallback="true"
      :delay="60"
      :delay-on-touch-only="false"
      @end="onDragEnd"
    >
      <div
        v-for="project in draggableProjects"
        :key="project.id"
        class="tab tab--project"
        :class="{ 'tab--active': projectsStore.activeTab === project.id }"
        @click="switchToProject(project.id)"
      >
        <span v-if="sessionsStore.hasActiveCards(project.id)" class="activity-dot" />
        <span class="tab-name">{{ project.name }}</span>
        <UButton
          variant="ghost"
          color="neutral"
          size="xs"
          icon="i-lucide-x"
          class="tab-close"
          square
          @click.stop="closeProject(project.id)"
          title="Close project"
        />
      </div>
    </VueDraggable>

    <!-- Add project -->
    <UButton
      variant="ghost"
      color="neutral"
      size="sm"
      icon="i-lucide-plus"
      class="add-tab"
      square
      title="Add project"
      @click="addProject"
    />

    <div class="spacer" />

    <!-- Project settings (visible when a project tab is active) -->
    <UButton
      v-if="projectsStore.isProjectTab"
      variant="ghost"
      color="neutral"
      size="xs"
      icon="i-lucide-sliders-horizontal"
      class="action-btn"
      square
      title="Project settings"
      @click="emit('open-project-settings')"
    />
  </div>
</template>

<style scoped>
.tab-bar {
  display: flex;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  padding: 0 8px;
  gap: 2px;
  height: 36px;
  align-items: flex-end;
  -webkit-app-region: drag;
}

.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  border-radius: 6px 6px 0 0;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  -webkit-app-region: no-drag;
  transition: background 0.15s;
}
.tab:hover { background: var(--bg-tertiary); }
.tab--active { background: var(--bg-primary); color: var(--text-primary); }

.tab--pinned {
  padding: 6px 10px;
  flex-shrink: 0;
}
.tab-icon { font-size: 16px; }

.project-tabs { display: flex; gap: 2px; align-items: flex-end; -webkit-app-region: no-drag; }
.tab--project { padding: 6px 12px 6px 16px; }
.activity-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  flex-shrink: 0;
  animation: pulse-dot 2s ease-in-out infinite;
}
@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
.tab-name { pointer-events: none; }
.tab-close { opacity: 0; transition: opacity 0.15s; -webkit-app-region: no-drag; }
.tab:hover .tab-close { opacity: 1; }

.add-tab { -webkit-app-region: no-drag; }
.action-btn { -webkit-app-region: no-drag; }
.spacer { flex: 1; }
</style>
