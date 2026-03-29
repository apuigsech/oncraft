<script setup lang="ts">
import { exists } from '@tauri-apps/plugin-fs'
import {
  getProjectCardSummaries, getActiveCardsAllProjects, getUsageMetrics, getCostByDay,
  type ProjectCardSummary, type ActiveCardRow, type UsageMetrics,
} from '~/services/database'
import { runHealthChecks, type HealthCheckResult } from '~/services/health-check'
import type { ActivityPriority, ActivityCardRow, DailyCost } from '~/types'

const projectsStore = useProjectsStore()
const sessionsStore = useSessionsStore()
const { addProject, switchToProject, reopenProject, navigateToCard } = useProjectActions()

// --- Block 1: Stats & Projects ---
const projectSummaries = ref<Map<string, ProjectCardSummary>>(new Map())
const projectPathExists = ref<Map<string, boolean>>(new Map())

async function loadProjectSummaries() {
  const summaries = await getProjectCardSummaries()
  const map = new Map<string, ProjectCardSummary>()
  for (const s of summaries) map.set(s.projectId, s)
  projectSummaries.value = map

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

// --- Block 2: Activity ---
const activityRows = ref<ActiveCardRow[]>([])

async function loadActivityCards() {
  activityRows.value = await getActiveCardsAllProjects()
}

const sortedActivityCards = computed<ActivityCardRow[]>(() => {
  const priorityOrder: Record<ActivityPriority, number> = { attention: 0, active: 1, unseen: 2, inactive: 3 }

  return activityRows.value.map(row => {
    // Determine priority from live data
    let priority: ActivityPriority = 'inactive'
    let toolName: string | undefined
    let toolContext: string | undefined

    const attention = sessionsStore.cardAttentionState.get(row.id)
    if (attention) {
      priority = 'attention'
      toolName = attention === 'approval' ? 'Approval' : attention === 'rate_limit' ? 'Rate Limit' : 'Error'
      const liveTool = sessionsStore.activeToolByCard.get(row.id)
      toolContext = liveTool ? `${liveTool.toolName}: ${liveTool.toolContext}` : ''
    } else if (row.state === 'active') {
      priority = 'active'
      const liveTool = sessionsStore.activeToolByCard.get(row.id)
      if (liveTool) {
        toolName = liveTool.toolName
        toolContext = liveTool.toolContext
      }
    } else if (!row.lastViewedAt || row.lastActivityAt > row.lastViewedAt) {
      priority = 'unseen'
    }

    return {
      id: row.id,
      projectId: row.projectId,
      projectName: row.projectName,
      name: row.name,
      columnName: row.columnName,
      lastActivityAt: row.lastActivityAt,
      lastViewedAt: row.lastViewedAt,
      state: row.state,
      priority,
      toolName,
      toolContext,
    } satisfies ActivityCardRow
  }).sort((a, b) => {
    const pa = priorityOrder[a.priority]
    const pb = priorityOrder[b.priority]
    if (pa !== pb) return pa - pb
    return new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()
  })
})

function formatDuration(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const remMins = mins % 60
  return `${hours}h ${remMins}m`
}

function priorityBorderColor(priority: ActivityPriority): string {
  switch (priority) {
    case 'attention': return 'var(--error)'
    case 'active': return 'var(--success)'
    case 'unseen': return 'var(--accent)'
    case 'inactive': return 'var(--border)'
  }
}

function toolBadgeStyle(toolName: string): { color: string; bg: string } {
  const name = toolName.toLowerCase()
  if (name === 'bash') return { color: '#7aa2f7', bg: '#7aa2f733' }
  if (name === 'edit' || name === 'write') return { color: '#e0af68', bg: '#e0af6833' }
  if (name === 'read' || name === 'glob' || name === 'grep') return { color: '#9ece6a', bg: '#9ece6a33' }
  if (name === 'approval') return { color: '#f7768e', bg: '#f7768e33' }
  if (name === 'rate limit') return { color: '#e0af68', bg: '#e0af6833' }
  if (name === 'error') return { color: '#f7768e', bg: '#f7768e33' }
  return { color: '#bb9af7', bg: '#bb9af733' }
}

// --- Block 3: Usage ---
const usageMetrics = ref<UsageMetrics | null>(null)
const costByDay = ref<DailyCost[]>([])

async function loadUsageMetrics() {
  usageMetrics.value = await getUsageMetrics()
}

async function loadCostByDay() {
  costByDay.value = await getCostByDay(7)
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

// Fill missing days so sparkline always shows 7 bars
const todayDateStr = computed(() => new Date().toISOString().slice(0, 10))
const fullSparkline = computed<DailyCost[]>(() => {
  const result: DailyCost[] = []
  const today = new Date()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().slice(0, 10)
    const existing = costByDay.value.find(c => c.date === dateStr)
    result.push({ date: dateStr, cost: existing?.cost ?? 0 })
  }
  return result
})

const sparklineMax = computed(() => {
  if (fullSparkline.value.length === 0) return 1
  return Math.max(...fullSparkline.value.map(d => d.cost), 0.01)
})

// --- Block 4: System Health ---
const healthResult = ref<HealthCheckResult | null>(null)
const healthLoading = ref(false)

async function loadHealthChecks() {
  healthLoading.value = true
  try {
    healthResult.value = await runHealthChecks()
  } catch (err) {
    if (import.meta.dev) console.error('[OnCraft] health check failed:', err)
  } finally {
    healthLoading.value = false
  }
}

// Stats bar computed values
const activeSessionCount = computed(() =>
  sortedActivityCards.value.filter(c => c.priority === 'active' || c.priority === 'attention').length
)

const healthSummaryLabel = computed(() => {
  if (!healthResult.value) return ''
  const items = healthResult.value.items
  const red = items.filter(i => i.status === 'red').length
  const amber = items.filter(i => i.status === 'amber').length
  if (red > 0) return `${red} issue${red > 1 ? 's' : ''}`
  if (amber > 0) return `${amber} warning${amber > 1 ? 's' : ''}`
  return 'All OK'
})

// Project avatar color from name hash
function avatarColor(name: string): string {
  const colors = ['#7aa2f7', '#9ece6a', '#e0af68', '#bb9af7', '#f7768e', '#73daca', '#ff9e64', '#2ac3de']
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
  return colors[Math.abs(hash) % colors.length]!
}

function handleProjectClick(projectId: string) {
  const project = projectsStore.projects.find(p => p.id === projectId)
  if (!project) return
  if (project.closed) {
    reopenProject(projectId)
  } else {
    switchToProject(projectId)
  }
}

onMounted(() => {
  loadProjectSummaries()
  loadActivityCards()
  loadUsageMetrics()
  loadCostByDay()
  loadHealthChecks()
})
</script>

<template>
  <div class="home-screen">
    <!-- Zone 1: Stats Bar -->
    <div class="stats-bar">
      <div class="stat-item">
        <span class="stat-dot stat-dot--active" />
        <span class="stat-value">{{ activeSessionCount }}</span>
        <span class="stat-label">active</span>
      </div>
      <div class="stat-divider" />
      <div v-if="usageMetrics" class="stat-item">
        <span class="stat-value">{{ formatCost(usageMetrics.costToday) }}</span>
        <span class="stat-label">today</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">{{ usageMetrics?.sessionCount ?? 0 }} sessions</span>
      </div>
      <div class="stat-spacer" />
      <div v-if="healthResult" class="stat-item stat-item--health">
        <span
          v-for="item in healthResult.items"
          :key="item.label"
          class="stat-health-dot"
          :class="`stat-health-dot--${item.status}`"
          :title="item.label"
        />
        <span class="stat-label">{{ healthSummaryLabel }}</span>
      </div>
    </div>

    <div class="home-grid">
      <!-- Zone 2: Recent Projects -->
      <section class="home-block">
        <div class="block-header">
          <span class="block-title">Recent Projects</span>
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
              class="project-row"
              :class="{
                'project-row--closed': project.closed,
                'project-row--warning': projectPathExists.get(project.id) === false,
              }"
              @click="handleProjectClick(project.id)"
            >
              <div
                class="project-avatar"
                :style="{ background: project.closed ? 'var(--bg-tertiary)' : avatarColor(project.name) + '22' }"
              >
                <span
                  class="project-avatar-letter"
                  :style="{ color: project.closed ? 'var(--text-muted)' : avatarColor(project.name) }"
                >{{ project.name.charAt(0).toUpperCase() }}</span>
              </div>
              <div class="project-info">
                <div class="project-name-row">
                  <span class="project-name">{{ project.name }}</span>
                  <span v-if="!project.closed && getSummary(project.id).activeCount > 0" class="project-active-dot" />
                  <UIcon
                    v-if="projectPathExists.get(project.id) === false"
                    name="i-lucide-triangle-alert"
                    class="project-warning-icon"
                    title="Directory not found on disk"
                  />
                </div>
                <span class="project-path" :title="project.path">{{ project.path }}</span>
              </div>
              <div class="project-stats">
                <span v-if="!project.closed && getSummary(project.id).activeCount > 0" class="pstat pstat--active">
                  {{ getSummary(project.id).activeCount }} active
                </span>
                <span class="pstat">{{ getSummary(project.id).totalCount }} cards</span>
                <span class="pstat">{{ formatRelativeTime(getSummary(project.id).lastActivityAt || project.lastOpenedAt) }}</span>
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

      <!-- Zone 3: Activity (Smart Panel) -->
      <section class="home-block">
        <div class="block-header">
          <span class="block-title">Activity</span>
          <div class="block-header-spacer" />
          <UButton
            v-if="activityRows.length > 0"
            variant="ghost"
            color="neutral"
            size="xs"
            icon="i-lucide-refresh-cw"
            @click="loadActivityCards"
          />
        </div>
        <div class="block-content">
          <div v-if="sortedActivityCards.length > 0" class="activity-list">
            <div
              v-for="card in sortedActivityCards"
              :key="card.id"
              class="activity-row"
              :style="{ borderLeftColor: priorityBorderColor(card.priority) }"
              @click="navigateToCard(card.projectId, card.id)"
            >
              <div class="activity-top">
                <span class="activity-name">{{ card.name }}</span>
                <span v-if="card.priority === 'unseen'" class="activity-new-badge">new</span>
                <span class="activity-meta">{{ card.projectName }} · {{ card.columnName }}</span>
                <span class="activity-time">{{ formatDuration(card.lastActivityAt) }}</span>
              </div>
              <div v-if="card.toolName" class="activity-tool">
                <span
                  class="tool-badge"
                  :style="{ color: toolBadgeStyle(card.toolName).color, background: toolBadgeStyle(card.toolName).bg }"
                >{{ card.toolName }}</span>
                <span v-if="card.toolContext" class="tool-context">{{ card.toolContext }}</span>
              </div>
              <div v-else-if="card.priority === 'inactive'" class="activity-tool">
                <span class="tool-context tool-context--muted">
                  {{ card.state === 'completed' ? 'Completed' : 'Idle' }} {{ formatDuration(card.lastActivityAt) }} ago
                </span>
              </div>
            </div>
          </div>
          <EmptyState
            v-else
            icon="i-lucide-radio"
            title="No activity"
            description="Start a chat on any card to see activity here."
          />
        </div>
      </section>

      <!-- Zone 4: Usage -->
      <section class="home-block">
        <div class="block-header">
          <span class="block-title">Usage</span>
        </div>
        <div class="block-content">
          <div v-if="usageMetrics && usageMetrics.sessionCount > 0" class="usage-panel">
            <div class="metrics-row">
              <div class="metric">
                <span class="metric-label">Today</span>
                <span class="metric-value">{{ formatCost(usageMetrics.costToday) }}</span>
              </div>
              <div class="metric">
                <span class="metric-label">Week</span>
                <span class="metric-value">{{ formatCost(usageMetrics.costWeek) }}</span>
              </div>
              <div class="metric">
                <span class="metric-label">Month</span>
                <span class="metric-value">{{ formatCost(usageMetrics.costMonth) }}</span>
              </div>
            </div>
            <!-- Sparkline -->
            <div v-if="costByDay.length > 0" class="sparkline">
              <div class="sparkline-label">Last 7 days</div>
              <div class="sparkline-bars">
                <div
                  v-for="day in fullSparkline"
                  :key="day.date"
                  class="sparkline-bar"
                  :class="{ 'sparkline-bar--today': day.date === todayDateStr }"
                  :style="{ height: Math.max(4, (day.cost / sparklineMax) * 100) + '%' }"
                  :title="`${day.date}: ${formatCost(day.cost)}`"
                />
              </div>
            </div>
            <!-- Token stats -->
            <div class="token-stats">
              <span class="tstat"><span class="tstat-label">Sessions </span><span class="tstat-value">{{ usageMetrics.sessionCount }}</span></span>
              <span class="tstat"><span class="tstat-label">Input </span><span class="tstat-value">{{ formatTokens(usageMetrics.inputTokens) }}</span></span>
              <span class="tstat"><span class="tstat-label">Output </span><span class="tstat-value">{{ formatTokens(usageMetrics.outputTokens) }}</span></span>
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

      <!-- Zone 5: System Health -->
      <section class="home-block">
        <div class="block-header">
          <span class="block-title">System Health</span>
          <div class="block-header-spacer" />
          <UButton
            variant="ghost"
            color="neutral"
            size="xs"
            icon="i-lucide-refresh-cw"
            :loading="healthLoading"
            @click="loadHealthChecks"
          />
        </div>
        <div class="block-content">
          <div v-if="healthResult" class="health-list">
            <div v-for="item in healthResult.items" :key="item.label" class="health-row">
              <div class="health-dot" :class="`health-dot--${item.status}`" />
              <span class="health-label">{{ item.label }}</span>
              <span class="health-detail">{{ item.detail }}</span>
              <span v-if="item.hint && item.status !== 'green'" class="health-hint">{{ item.hint }}</span>
            </div>
          </div>
          <EmptyState
            v-else
            icon="i-lucide-heart-pulse"
            title="Checking..."
            description="Running system health checks..."
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
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Zone 1: Stats Bar */
.stats-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 14px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: 8px;
  flex-shrink: 0;
}
.stat-item {
  display: flex;
  align-items: center;
  gap: 5px;
}
.stat-item--health {
  display: flex;
  align-items: center;
  gap: 4px;
}
.stat-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.stat-dot--active { background: var(--success); }
.stat-value {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}
.stat-label {
  font-size: 11px;
  color: var(--text-muted);
}
.stat-divider {
  width: 1px;
  height: 14px;
  background: var(--border);
  flex-shrink: 0;
}
.stat-spacer { flex: 1; }
.stat-health-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.stat-health-dot--green { background: var(--success); }
.stat-health-dot--amber { background: var(--warning); }
.stat-health-dot--red { background: var(--error); }

/* Grid */
.home-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
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
  padding: 12px 14px 0;
}
.block-header-spacer { flex: 1; }
.block-title {
  font-size: 10px;
  font-weight: 600;
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.block-content {
  flex: 1;
  padding: 8px 14px 12px;
  overflow-y: auto;
}

/* Zone 2: Recent Projects */
.project-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.project-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--bg-tertiary);
  border: 1px solid transparent;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.project-row:hover {
  border-color: var(--border);
  background: var(--bg-primary);
}
.project-row--closed {
  opacity: 0.55;
}
.project-row--warning {
  border-color: var(--warning);
}

.project-avatar {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.project-avatar-letter {
  font-size: 12px;
  font-weight: 700;
}

.project-info {
  flex: 1;
  min-width: 0;
}
.project-name-row {
  display: flex;
  align-items: center;
  gap: 5px;
}
.project-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}
.project-active-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--success);
  flex-shrink: 0;
}
.project-warning-icon {
  width: 13px;
  height: 13px;
  color: var(--warning);
}
.project-path {
  font-size: 10px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: block;
  max-width: 100%;
  margin-top: 1px;
}

.project-stats {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
  flex-shrink: 0;
}
.pstat {
  font-size: 10px;
  color: var(--text-muted);
  white-space: nowrap;
}
.pstat--active {
  color: var(--success);
  font-weight: 600;
}

/* Zone 3: Activity */
.activity-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.activity-row {
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--bg-tertiary);
  border-left: 2px solid var(--border);
  cursor: pointer;
  transition: background 0.15s;
}
.activity-row:hover { background: var(--bg-primary); }

.activity-top {
  display: flex;
  align-items: center;
  gap: 6px;
}
.activity-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.activity-new-badge {
  font-size: 8px;
  font-weight: 500;
  color: var(--accent);
  background: var(--accent);
  background: rgba(122, 162, 247, 0.15);
  color: #7aa2f7;
  padding: 0 5px;
  border-radius: 3px;
  flex-shrink: 0;
}
.activity-meta {
  font-size: 10px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.activity-time {
  font-size: 10px;
  color: var(--text-muted);
  flex-shrink: 0;
  margin-left: auto;
}

.activity-tool {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 4px;
}
.tool-badge {
  font-size: 9px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 3px;
  flex-shrink: 0;
}
.tool-context {
  font-size: 9px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tool-context--muted {
  color: var(--text-muted);
}

/* Zone 4: Usage */
.usage-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.metrics-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.metric-label {
  font-size: 10px;
  color: var(--text-muted);
  text-transform: uppercase;
}
.metric-value {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.sparkline {
  margin-top: 2px;
}
.sparkline-label {
  font-size: 9px;
  color: var(--text-muted);
  text-transform: uppercase;
  margin-bottom: 4px;
}
.sparkline-bars {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 32px;
}
.sparkline-bar {
  flex: 1;
  background: rgba(122, 162, 247, 0.25);
  border-radius: 2px 2px 0 0;
  min-height: 2px;
  transition: height 0.3s;
}
.sparkline-bar--today {
  background: var(--accent);
}

.token-stats {
  display: flex;
  gap: 16px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}
.tstat {
  font-size: 10px;
}
.tstat-label { color: var(--text-muted); }
.tstat-value { color: var(--text-primary); font-weight: 600; }

/* Zone 5: System Health */
.health-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.health-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: var(--bg-tertiary);
  border-radius: 5px;
  flex-wrap: wrap;
}
.health-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.health-dot--green { background: var(--success); }
.health-dot--amber { background: var(--warning); }
.health-dot--red { background: var(--error); }
.health-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-primary);
  min-width: 80px;
}
.health-detail {
  font-size: 10px;
  color: var(--text-muted);
}
.health-hint {
  font-size: 10px;
  color: var(--warning);
  font-style: italic;
  margin-left: auto;
}

@media (max-width: 700px) {
  .home-grid { grid-template-columns: 1fr; }
  .home-screen { padding: 16px 12px; }
  .stats-bar { flex-wrap: wrap; }
}
</style>
