<script setup lang="ts">
/**
 * Home screen with four content blocks:
 * 1. Recent Projects  2. Global Activity  3. Usage Metrics  4. System Health
 * Blocks are populated incrementally in Steps 4.2–4.5.
 */
const { addProject } = useProjectActions()
</script>

<template>
  <div class="home-screen">
    <header class="home-header">
      <h1 class="home-title">OnCraft</h1>
      <p class="home-subtitle">Kanban for Claude Code sessions</p>
    </header>

    <div class="home-grid">
      <!-- Block 1: Recent Projects (Step 4.2) -->
      <section class="home-block">
        <div class="block-header">
          <UIcon name="i-lucide-folder-open" class="block-icon" />
          <h2 class="block-title">Recent Projects</h2>
        </div>
        <div class="block-content">
          <EmptyState
            icon="i-lucide-folder-plus"
            title="No projects yet"
            description="Open a project folder to get started."
            action-label="Open project"
            action-icon="i-lucide-plus"
            @action="addProject"
          />
        </div>
      </section>

      <!-- Block 2: Global Activity (Step 4.3) -->
      <section class="home-block">
        <div class="block-header">
          <UIcon name="i-lucide-activity" class="block-icon" />
          <h2 class="block-title">Activity</h2>
        </div>
        <div class="block-content">
          <EmptyState
            icon="i-lucide-radio"
            title="No active sessions"
            description="Start a chat on any card to see activity here."
          />
        </div>
      </section>

      <!-- Block 3: Usage Metrics (Step 4.4) -->
      <section class="home-block">
        <div class="block-header">
          <UIcon name="i-lucide-bar-chart-3" class="block-icon" />
          <h2 class="block-title">Usage</h2>
        </div>
        <div class="block-content">
          <EmptyState
            icon="i-lucide-bar-chart-3"
            title="No usage data"
            description="Metrics will appear after your first session."
          />
        </div>
      </section>

      <!-- Block 4: System Health (Step 4.5) -->
      <section class="home-block">
        <div class="block-header">
          <UIcon name="i-lucide-heart-pulse" class="block-icon" />
          <h2 class="block-title">System Health</h2>
        </div>
        <div class="block-content">
          <EmptyState
            icon="i-lucide-heart-pulse"
            title="Checking..."
            description="System health checks will appear here."
          />
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.home-screen {
  height: 100%;
  overflow-y: auto;
  padding: 32px 40px;
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.home-header {
  text-align: center;
  padding: 8px 0 4px;
}
.home-title {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}
.home-subtitle {
  font-size: 13px;
  color: var(--text-muted);
  margin: 4px 0 0;
}

.home-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  flex: 1;
  min-height: 0;
}

.home-block {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  min-height: 180px;
  overflow: hidden;
}

.block-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px 0;
}
.block-icon {
  width: 16px;
  height: 16px;
  color: var(--accent);
  flex-shrink: 0;
}
.block-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.block-content {
  flex: 1;
  padding: 8px 16px 14px;
  overflow-y: auto;
}

@media (max-width: 700px) {
  .home-grid { grid-template-columns: 1fr; }
  .home-screen { padding: 20px 16px; }
}
</style>
