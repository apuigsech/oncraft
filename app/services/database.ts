import Database from '@tauri-apps/plugin-sql';
import type { Project, Card } from '~/types';

let db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (db) return db;
  db = await Database.load('sqlite:oncraft.db');
  await runMigrations(db);
  return db;
}

async function runMigrations(db: Database): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_opened_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      column_name TEXT NOT NULL,
      column_order INTEGER DEFAULT 0,
      session_id TEXT DEFAULT '',
      state TEXT DEFAULT 'idle',
      tags TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_activity_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      archived INTEGER DEFAULT 0,
      use_worktree INTEGER DEFAULT 0,
      worktree_name TEXT DEFAULT ''
    )
  `);
  // Migration: add archived column if missing (for existing DBs)
  try {
    await db.execute('ALTER TABLE cards ADD COLUMN archived INTEGER DEFAULT 0');
  } catch { /* column already exists */ }
  // Migration: add worktree columns if missing (for existing DBs)
  try {
    await db.execute('ALTER TABLE cards ADD COLUMN use_worktree INTEGER DEFAULT 0');
  } catch { /* column already exists */ }
  try {
    await db.execute("ALTER TABLE cards ADD COLUMN worktree_name TEXT DEFAULT ''");
  } catch { /* column already exists */ }
  // Migration: add console_session_id for console mode (terminal) sessions
  try {
    await db.execute("ALTER TABLE cards ADD COLUMN console_session_id TEXT DEFAULT ''");
  } catch { /* column already exists */ }
  // Migration: add linked_files and linked_issues JSON columns
  try {
    await db.execute("ALTER TABLE cards ADD COLUMN linked_files TEXT DEFAULT '{}'");
  } catch { /* column already exists */ }
  try {
    await db.execute("ALTER TABLE cards ADD COLUMN linked_issues TEXT DEFAULT '[]'");
  } catch { /* column already exists */ }
  // Migration: add cost tracking columns if missing (for existing DBs)
  try {
    await db.execute('ALTER TABLE cards ADD COLUMN cost_usd REAL DEFAULT 0');
  } catch { /* column already exists */ }
  try {
    await db.execute('ALTER TABLE cards ADD COLUMN input_tokens INTEGER DEFAULT 0');
  } catch { /* column already exists */ }
  try {
    await db.execute('ALTER TABLE cards ADD COLUMN output_tokens INTEGER DEFAULT 0');
  } catch { /* column already exists */ }
  try {
    await db.execute('ALTER TABLE cards ADD COLUMN duration_ms INTEGER DEFAULT 0');
  } catch { /* column already exists */ }
  // Migration: add forked_from_id for session forking
  try {
    await db.execute("ALTER TABLE cards ADD COLUMN forked_from_id TEXT DEFAULT ''");
  } catch { /* column already exists */ }
  // Migration: add tab_order for persistent project tab ordering
  try {
    await db.execute('ALTER TABLE projects ADD COLUMN tab_order INTEGER DEFAULT 0');
  } catch { /* column already exists */ }
}

export async function insertProject(project: Project): Promise<void> {
  const d = await getDb();
  await d.execute(
    'INSERT INTO projects (id, name, path, created_at, last_opened_at) VALUES ($1, $2, $3, $4, $5)',
    [project.id, project.name, project.path, project.createdAt, project.lastOpenedAt]
  );
}

export async function getAllProjects(): Promise<Project[]> {
  const d = await getDb();
  const rows = await d.select<Array<{
    id: string; name: string; path: string;
    created_at: string; last_opened_at: string; tab_order: number;
  }>>('SELECT * FROM projects ORDER BY tab_order ASC, last_opened_at DESC');
  return rows.map(r => ({
    id: r.id, name: r.name, path: r.path,
    createdAt: r.created_at, lastOpenedAt: r.last_opened_at,
  }));
}

export async function updateProjectTabOrder(orderedIds: string[]): Promise<void> {
  if (orderedIds.length === 0) return;
  const d = await getDb();
  // Single UPDATE with CASE to avoid N round-trips
  const whenClauses = orderedIds.map((_, i) => `WHEN $${i + 1} THEN ${i}`).join(' ');
  const placeholders = orderedIds.map((_, i) => `$${i + 1}`).join(', ');
  await d.execute(
    `UPDATE projects SET tab_order = CASE id ${whenClauses} END WHERE id IN (${placeholders})`,
    orderedIds,
  );
}

export async function updateProjectLastOpened(id: string): Promise<void> {
  const d = await getDb();
  await d.execute(
    'UPDATE projects SET last_opened_at = CURRENT_TIMESTAMP WHERE id = $1',
    [id]
  );
}

export async function deleteProject(id: string): Promise<void> {
  const d = await getDb();
  await d.execute('DELETE FROM projects WHERE id = $1', [id]);
}

export async function getCardsByProject(projectId: string): Promise<Card[]> {
  const d = await getDb();
  const rows = await d.select<Array<{
    id: string; project_id: string; name: string; description: string;
    column_name: string; column_order: number; session_id: string;
    console_session_id: string;
    state: string; tags: string; created_at: string; last_activity_at: string;
    archived: number; use_worktree: number; worktree_name: string;
    linked_files: string; linked_issues: string;
    cost_usd: number; input_tokens: number; output_tokens: number; duration_ms: number;
    forked_from_id: string;
  }>>('SELECT * FROM cards WHERE project_id = $1 ORDER BY column_order ASC', [projectId]);
  return rows.map(r => {
    const linkedFiles = r.linked_files ? JSON.parse(r.linked_files) : {};
    const linkedIssues = r.linked_issues ? JSON.parse(r.linked_issues) : [];
    return {
      id: r.id, projectId: r.project_id, name: r.name, description: r.description,
      columnName: r.column_name, columnOrder: r.column_order, sessionId: r.session_id,
      consoleSessionId: r.console_session_id || undefined,
      state: r.state as Card['state'], tags: JSON.parse(r.tags),
      createdAt: r.created_at, lastActivityAt: r.last_activity_at,
      archived: r.archived === 1,
      useWorktree: r.use_worktree === 1,
      worktreeName: r.worktree_name || undefined,
      linkedFiles: Object.keys(linkedFiles).length > 0 ? linkedFiles : undefined,
      linkedIssues: linkedIssues.length > 0 ? linkedIssues : undefined,
      costUsd: r.cost_usd || 0,
      inputTokens: r.input_tokens || 0,
      outputTokens: r.output_tokens || 0,
      durationMs: r.duration_ms || 0,
      forkedFromId: r.forked_from_id || undefined,
    };
  });
}

export async function insertCard(card: Card): Promise<void> {
  const d = await getDb();
  await d.execute(
    `INSERT INTO cards (id, project_id, name, description, column_name, column_order, session_id, state, tags, created_at, last_activity_at, use_worktree, worktree_name, forked_from_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [card.id, card.projectId, card.name, card.description, card.columnName,
     card.columnOrder, card.sessionId, card.state, JSON.stringify(card.tags),
     card.createdAt, card.lastActivityAt, card.useWorktree ? 1 : 0, card.worktreeName || '',
     card.forkedFromId || '']
  );
}

export async function updateCard(card: Card): Promise<void> {
  const d = await getDb();
  await d.execute(
    `UPDATE cards SET name=$1, description=$2, column_name=$3, column_order=$4,
     session_id=$5, state=$6, tags=$7, last_activity_at=$8, archived=$9,
     use_worktree=$10, worktree_name=$11, console_session_id=$12,
     linked_files=$13, linked_issues=$14,
     cost_usd=$15, input_tokens=$16, output_tokens=$17, duration_ms=$18,
     forked_from_id=$19 WHERE id=$20`,
    [card.name, card.description, card.columnName, card.columnOrder,
     card.sessionId, card.state, JSON.stringify(card.tags),
     card.lastActivityAt, card.archived ? 1 : 0,
     card.useWorktree ? 1 : 0, card.worktreeName || '',
     card.consoleSessionId || '',
     JSON.stringify(card.linkedFiles || {}),
     JSON.stringify(card.linkedIssues || []),
     card.costUsd || 0, card.inputTokens || 0, card.outputTokens || 0, card.durationMs || 0,
     card.forkedFromId || '',
     card.id]
  );
}

export async function deleteCard(id: string): Promise<void> {
  const d = await getDb();
  await d.execute('DELETE FROM cards WHERE id = $1', [id]);
}

export async function batchUpdateCardPositions(
  updates: { id: string; columnName: string; columnOrder: number }[]
): Promise<void> {
  const d = await getDb();
  for (const u of updates) {
    await d.execute(
      'UPDATE cards SET column_name = $1, column_order = $2, last_activity_at = CURRENT_TIMESTAMP WHERE id = $3',
      [u.columnName, u.columnOrder, u.id]
    );
  }
}

export async function updateCardsColumn(
  cardIds: string[], columnName: string
): Promise<void> {
  const d = await getDb();
  for (let i = 0; i < cardIds.length; i++) {
    await d.execute(
      'UPDATE cards SET column_name = $1, column_order = $2, last_activity_at = CURRENT_TIMESTAMP WHERE id = $3',
      [columnName, i, cardIds[i]]
    );
  }
}

// --- Cross-project queries for Home screen ---

export interface ProjectCardSummary {
  projectId: string;
  activeCount: number;
  totalCount: number;
  lastActivityAt: string | null;
}

export async function getProjectCardSummaries(): Promise<ProjectCardSummary[]> {
  const d = await getDb();
  const rows = await d.select<Array<{
    project_id: string;
    active_count: number;
    total_count: number;
    last_activity: string | null;
  }>>(`
    SELECT
      project_id,
      SUM(CASE WHEN state = 'active' THEN 1 ELSE 0 END) AS active_count,
      COUNT(*) AS total_count,
      MAX(last_activity_at) AS last_activity
    FROM cards
    WHERE archived = 0
    GROUP BY project_id
  `);
  return rows.map(r => ({
    projectId: r.project_id,
    activeCount: r.active_count,
    totalCount: r.total_count,
    lastActivityAt: r.last_activity,
  }));
}

export interface ActiveCardRow {
  id: string;
  projectId: string;
  name: string;
  columnName: string;
  lastActivityAt: string;
}

export async function getActiveCardsAllProjects(): Promise<ActiveCardRow[]> {
  const d = await getDb();
  const rows = await d.select<Array<{
    id: string; project_id: string; name: string;
    column_name: string; last_activity_at: string;
  }>>(`
    SELECT id, project_id, name, column_name, last_activity_at
    FROM cards
    WHERE state = 'active' AND archived = 0
    ORDER BY last_activity_at DESC
  `);
  return rows.map(r => ({
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    columnName: r.column_name,
    lastActivityAt: r.last_activity_at,
  }));
}

export interface UsageMetrics {
  costToday: number;
  costWeek: number;
  costMonth: number;
  inputTokens: number;
  outputTokens: number;
  sessionCount: number;
}

export async function getUsageMetrics(): Promise<UsageMetrics> {
  const d = await getDb();
  const rows = await d.select<Array<{
    cost_today: number; cost_week: number; cost_month: number;
    input_tokens: number; output_tokens: number; session_count: number;
  }>>(`
    SELECT
      COALESCE(SUM(CASE WHEN date(last_activity_at) = date('now') THEN cost_usd ELSE 0 END), 0) AS cost_today,
      COALESCE(SUM(CASE WHEN last_activity_at >= datetime('now', '-7 days') THEN cost_usd ELSE 0 END), 0) AS cost_week,
      COALESCE(SUM(CASE WHEN last_activity_at >= datetime('now', '-30 days') THEN cost_usd ELSE 0 END), 0) AS cost_month,
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens,
      COUNT(*) AS session_count
    FROM cards
    WHERE session_id != '' AND session_id IS NOT NULL
  `);
  const r = rows[0] || { cost_today: 0, cost_week: 0, cost_month: 0, input_tokens: 0, output_tokens: 0, session_count: 0 };
  return {
    costToday: r.cost_today,
    costWeek: r.cost_week,
    costMonth: r.cost_month,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    sessionCount: r.session_count,
  };
}
