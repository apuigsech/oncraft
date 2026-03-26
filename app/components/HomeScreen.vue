<script setup lang="ts">
import { exists } from '@tauri-apps/plugin-fs'
import { getProjectCardSummaries, getActiveCardsAllProjects, getUsageMetrics, type ProjectCardSummary, type ActiveCardRow, type UsageMetrics } from '~/services/database'

const projectsStore = useProjectsStore()
const { addProject, switchToProject, navigateToCard } = useProjectActions()

// --- Block 1: Recent Projects ---
const projectSummaries = ref<Map<string, ProjectCardSummary>>(new Map())
const projectPathExists = ref<Map<string, boolean>>(new Map())

async function loadProjectSummaries() {
  const summaries = await getProjectCardSummaries()
  const map = new Map<string, ProjectCardSummary>()
  for (const s of summaries) map.set(s.projectId, s)
  projectSummaries.value = map

  // Check disk existence in parallel
  const checks = projectsStore.projects.map(async (p) => {
    try {
      const ok = await exists(p.path)
      return [p.id, ok] as const
    } catch {
      return [p.id, false] as const
    }
  })
  const results = await Promise.all(checks)
  const pathMap = new Map<string, boolean>()
  for (const [id, ok] of results) pathMap.set(id, ok)
  projectPathExists.value = pathMap
}

function getSummary(projectId: string): ProjectCardSummary {
  return projectSummaries.value.get(projectId) || {
    projectId, activeCount: 0, totalCount: 0, lastActivityAt: null,
  }
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return 'No activity'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString()
}

// --- Block 2: Global Activity ---
const activeCards = ref<ActiveCardRow[]>([])

async function loadActiveCards() {
  activeCards.value = await getActiveCardsAllProjects()
}

function getProjectName(projectId: string): string {
  const p = projectsStore.projects.find(p => p.id === projectId)
  return p?.name || 'Unknown'
}

// --- Block 3: Usage Metrics ---
const usageMetrics = ref<UsageMetrics | null>(null)

async function loadUsageMetrics() {
  usageMetrics.value = await getUsageMetrics()
}

function formatCost(value: number): string {
  if (value === 0) return '$0.00'
  if (value < 0.01) return '<$0.01'
  return `$${value.toFixed(2)}`
}

function formatTokens(value: number): string {
  if (value === 0) return '0'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(value)
}

onMounted(() => {
  loadProjectSummaries()
  loadActiveCards()
  loadUsageMetrics()
})
</script>

<template>
  <div class="home-screen">
    <header class="home-header">
      <h1 class="home-title">OnCraft</h1>
      <p class="home-subtitle">Kanban for Claude Code sessions</p>
    </header>

    <div class="home-grid">
      <!-- Block 1: Recent Projects -->
      <section class="home-block">
        <div class="block-header">
          <UIcon name="i-lucide-folder-open" class="block-icon" />
          <h2 class="block-title">Recent Projects</h2>
          <div class="block-header-spacer" />
          <UButton
            variant="ghost"
            color="neutral"
            size="xs"
            icon="i-lucide-plus"
            @click="addProject"
          >
            Open project
          </UButton>
        </div>
        <div class="block-content">
          <div v-if="projectsStore.projects.length > 0" class="project-list">
            <div
              v-for="project in projectsStore.projects"
              :key="project.id"
              class="project-card"
              :class="{ 'project-card--warning': projectPathExists.get(project.id) === false }"
              @click="switchToProject(project.id)"
            >
              <div class="project-card-top">
                <span class="project-name">{{ project.name }}</span>
                <UIcon
                  v-if="projectPathExists.get(project.id) === false"
                  name="i-lucide-triangle-alert"
                  class="project-warning-icon"
                  title="Directory not found on disk"
                />
              </div>
              <div class="project-card-meta">
                <span class="project-path" :title="project.path">{{ project.path }}</span>
              </div>
              <div class="project-card-stats">
                <span v-if="getSummary(project.id).activeCount > 0" class="stat stat--active">
                  {{ getSummary(project.id).activeCount }} active
                </span>
                <span class="stat">
                  {{ getSummary(project.id).totalCount }} cards
                </span>
                <span class="stat stat--time">
                  {{ formatRelativeTime(getSummary(project.id).lastActivityAt || project.lastOpenedAt) }}
                </span>
              </div>
            </div>
          </div>
          <EmptyState
            v-else
            icon="i-lucide-folder-plus"
            title="No projects yet"
            description="Open a project folder to get started."
            action-label="Open project"
            action-icon="i-lucide-plus"
            @action="addProject"
          />
        </div>
      </section>

      <!-- Block 2: Global Activity -->
      <section class="home-block">
        <div class="block-header">
          <UIcon name="i-lucide-activity" class="block-icon" />
          <h2 class="block-title">Activity</h2>
          <div class="block-header-spacer" />
          <UButton
            v-if="activeCards.length > 0"
            variant="ghost"
            color="neutral"
            size="xs"
            icon="i-lucide-refresh-cw"
            @click="loadActiveCards"
          />
        </div>
        <div class="block-content">
          <div v-if="activeCards.length > 0" class="activity-list">
            <div
              v-for="card in activeCards"
              :key="card.id"
              class="activity-row"
              @click="navigateToCard(card.projectId, card.id)"
            >
              <div class="activity-indicator" />
              <div class="activity-info">
                <span class="activity-name">{{ card.name }}</span>
                <span class="activity-meta">
                  {{ getProjectName(card.projectId) }} · {{ card.columnName }}
                </span>
              </div>
              <span class="activity-time">{{ formatRelativeTime(card.lastActivityAt) }}</span>
            </div>
          </div>
          <EmptyState
            v-else
            icon="i-lucide-radio"
            title="No active sessions"
            description="Start a chat on any card to see activity here."
          />
        </div>
      </section>

      <!-- Block 3: Usage Metrics -->
      <section class="home-block">
        <div class="block-header">
          <UIcon name="i-lucide-bar-chart-3" class="block-icon" />
          <h2 class="block-title">Usage</h2>
        </div>
        <div class="block-content">
          <div v-if="usageMetrics && usageMetrics.sessionCount > 0" class="metrics-grid">
            <div class="metric">
              <span class="metric-label">Today</span>
              <span class="metric-value">{{ formatCost(usageMetrics.costToday) }}</span>
            </div>
            <div class="metric">
              <span class="metric-label">This week</span>
              <span class="metric-value">{{ formatCost(usageMetrics.costWeek) }}</span>
            </div>
            <div class="metric">
              <span class="metric-label">This month</span>
              <span class="metric-value">{{ formatCost(usageMetrics.costMonth) }}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Sessions</span>
              <span class="metric-value">{{ usageMetrics.sessionCount }}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Input tokens</span>
              <span class="metric-value">{{ formatTokens(usageMetrics.inputTokens) }}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Output tokens</span>
              <span class="metric-value">{{ formatTokens(usageMetrics.outputTokens) }}</span>
            </div>
          </div>
          <EmptyState
            v-else
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
.block-header-spacer { flex: 1; }
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

/* Recent Projects */
.project-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.project-card {
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--bg-tertiary);
  border: 1px solid transparent;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.project-card:hover {
  border-color: var(--border);
  background: var(--bg-primary);
}
.project-card--warning {
  border-color: var(--warning);
  opacity: 0.7;
}

.project-card-top {
  display: flex;
  align-items: center;
  gap: 6px;
}
.project-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.project-warning-icon {
  width: 14px;
  height: 14px;
  color: var(--warning);
}

.project-card-meta {
  margin-top: 3px;
}
.project-path {
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: block;
  max-width: 100%;
}

.project-card-stats {
  display: flex;
  gap: 10px;
  margin-top: 6px;
}
.stat {
  font-size: 11px;
  color: var(--text-muted);
}
.stat--active {
  color: var(--success);
  font-weight: 600;
}
.stat--time {
  margin-left: auto;
}

/* Usage Metrics */
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  padding-top: 4px;
}
.metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.metric-label {
  font-size: 11px;
  color: var(--text-muted);
}
.metric-value {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

/* Global Activity */
.activity-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.activity-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
}
.activity-row:hover { background: var(--bg-tertiary); }
.activity-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--success);
  flex-shrink: 0;
  animation: pulse-dot 2s ease-in-out infinite;
}
@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
.activity-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.activity-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.activity-meta {
  font-size: 11px;
  color: var(--text-muted);
}
.activity-time {
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
}

@media (max-width: 700px) {
  .home-grid { grid-template-columns: 1fr; }
  .home-screen { padding: 20px 16px; }
}
</style>
