# ClaudBan Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Tauri + Vue 3 desktop app that manages Claude Code sessions as a Kanban board with configurable pipeline triggers.

**Architecture:** Tauri v2 (Rust) as the desktop shell with Vue 3 + TypeScript frontend. Claude Code CLI controlled via `@tauri-apps/plugin-shell` spawning child processes with `--output-format stream-json`. SQLite via `@tauri-apps/plugin-sql` for state persistence. VueDraggablePlus for Kanban drag & drop.

**Tech Stack:** Tauri v2, Vue 3 (Composition API), TypeScript, Pinia (state management), VueDraggablePlus, @tauri-apps/plugin-shell, @tauri-apps/plugin-sql, @tauri-apps/plugin-dialog, @tauri-apps/plugin-fs, js-yaml

---

## File Structure

```
claudban/
  src-tauri/
    Cargo.toml                      # Rust dependencies (tauri, plugins)
    tauri.conf.json                  # Tauri config (window, plugins, capabilities)
    capabilities/
      default.json                  # Permission declarations
    src/
      lib.rs                        # Plugin registration
      main.rs                       # Entry point

  src/
    main.ts                         # Vue app entry
    App.vue                         # Root: tab bar + router-less layout
    assets/
      main.css                      # Global styles (dark theme)

    stores/
      projects.ts                   # Pinia store: project CRUD, active tab
      cards.ts                      # Pinia store: card CRUD, column state
      sessions.ts                   # Pinia store: Claude process management
      settings.ts                   # Pinia store: global app settings
      pipelines.ts                  # Pinia store: pipeline config per project

    services/
      database.ts                   # SQLite init, migrations, queries
      config-loader.ts              # .claudban/config.yaml read/write/validate
      claude-process.ts             # Spawn/resume/kill Claude Code processes
      template-engine.ts            # Resolve {{variables}} in pipeline prompts
      stream-parser.ts              # Parse stream-json output into typed messages

    components/
      TabBar.vue                    # Project tabs + "+" button
      KanbanBoard.vue               # Columns container with horizontal scroll
      KanbanColumn.vue              # Single column with draggable cards
      KanbanCard.vue                # Card component (name, desc, status, tags)
      ChatPanel.vue                 # Session chat: messages + input
      ChatMessage.vue               # Single message bubble (assistant/user)
      ToolCallBlock.vue             # Collapsible tool call display
      NewSessionDialog.vue          # Modal: create new session (name + desc)
      ProjectSettings.vue           # Settings panel: columns + pipelines editor
      ColumnEditor.vue              # Column add/remove/rename/reorder/color
      PipelineEditor.vue            # Pipeline prompt template editor
      GlobalSettings.vue            # App-level settings
      StatusIndicator.vue           # Green/gray/red dot component

    types/
      index.ts                      # All TypeScript interfaces

  package.json
  tsconfig.json
  vite.config.ts
  index.html
```

---

## Chunk 1: Project Scaffolding and Foundation

### Task 1: Initialize Tauri + Vue project

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`
- Create: `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/src/lib.rs`, `src-tauri/src/main.rs`
- Create: `src/main.ts`, `src/App.vue`

- [ ] **Step 1: Scaffold the Tauri + Vue project**

Run:
```bash
pnpm create tauri-app claudban-init --template vue-ts --manager pnpm
```

Then copy the generated files into the current directory (since we already have a git repo).

- [ ] **Step 2: Install additional dependencies**

```bash
pnpm add pinia vue-draggable-plus js-yaml uuid
pnpm add -D @types/js-yaml @types/uuid
```

- [ ] **Step 3: Install Tauri plugins**

```bash
cd src-tauri
cargo add tauri-plugin-shell tauri-plugin-sql --features "tauri-plugin-sql/sqlite"
cargo add tauri-plugin-dialog tauri-plugin-fs
cd ..
pnpm add @tauri-apps/plugin-shell @tauri-apps/plugin-sql @tauri-apps/plugin-dialog @tauri-apps/plugin-fs
```

- [ ] **Step 4: Register plugins in `src-tauri/src/lib.rs`**

```rust
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 5: Configure capabilities in `src-tauri/capabilities/default.json`**

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capabilities for ClaudBan",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "shell:allow-spawn",
    "shell:allow-execute",
    "shell:allow-stdin-write",
    "shell:allow-kill",
    "sql:allow-load",
    "sql:allow-execute",
    "sql:allow-select",
    "dialog:allow-open",
    "fs:allow-read",
    "fs:allow-write",
    "fs:allow-exists",
    "fs:allow-mkdir"
  ]
}
```

- [ ] **Step 6: Verify the app builds and opens an empty window**

```bash
pnpm tauri dev
```

Expected: A native window opens with the default Vue template.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: scaffold Tauri v2 + Vue 3 project with plugins"
```

---

### Task 2: TypeScript types

**Files:**
- Create: `src/types/index.ts`

- [ ] **Step 1: Define all interfaces**

```typescript
// src/types/index.ts

export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  lastOpenedAt: string;
}

export interface Card {
  id: string;
  projectId: string;
  name: string;
  description: string;
  columnName: string;
  columnOrder: number;
  sessionId: string;
  state: CardState;
  tags: string[];
  createdAt: string;
  lastActivityAt: string;
}

export type CardState = 'active' | 'idle' | 'error' | 'completed';

export interface ColumnConfig {
  name: string;
  color: string;
}

export interface PipelineConfig {
  from: string;
  to: string;
  prompt: string;
}

export interface ProjectConfig {
  columns: ColumnConfig[];
  pipelines: PipelineConfig[];
}

export interface GlobalSettings {
  claudeBinaryPath: string;
  theme: 'dark' | 'light';
  defaultColumns: ColumnConfig[];
}

// Claude Code stream-json message types
export interface StreamMessage {
  type: 'assistant' | 'user' | 'tool_use' | 'tool_result' | 'system' | 'tool_confirmation';
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
  sessionId?: string; // Present in initial system message
  timestamp: number;
}

export interface TemplateContext {
  session: { name: string; id: string };
  project: { path: string; name: string };
  card: { description: string };
  column: { from: string; to: string };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add TypeScript interfaces for all domain types"
```

---

### Task 3: Database service

**Files:**
- Create: `src/services/database.ts`

- [ ] **Step 1: Write the database initialization and migration logic**

```typescript
// src/services/database.ts
import Database from '@tauri-apps/plugin-sql';
import type { Project, Card } from '../types';

let db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (db) return db;
  db = await Database.load('sqlite:claudban.db');
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
      last_activity_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
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
    created_at: string; last_opened_at: string;
  }>>('SELECT * FROM projects ORDER BY last_opened_at DESC');
  return rows.map(r => ({
    id: r.id, name: r.name, path: r.path,
    createdAt: r.created_at, lastOpenedAt: r.last_opened_at,
  }));
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
    state: string; tags: string; created_at: string; last_activity_at: string;
  }>>('SELECT * FROM cards WHERE project_id = $1 ORDER BY column_order ASC', [projectId]);
  return rows.map(r => ({
    id: r.id, projectId: r.project_id, name: r.name, description: r.description,
    columnName: r.column_name, columnOrder: r.column_order, sessionId: r.session_id,
    state: r.state as Card['state'], tags: JSON.parse(r.tags),
    createdAt: r.created_at, lastActivityAt: r.last_activity_at,
  }));
}

export async function insertCard(card: Card): Promise<void> {
  const d = await getDb();
  await d.execute(
    `INSERT INTO cards (id, project_id, name, description, column_name, column_order, session_id, state, tags, created_at, last_activity_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [card.id, card.projectId, card.name, card.description, card.columnName,
     card.columnOrder, card.sessionId, card.state, JSON.stringify(card.tags),
     card.createdAt, card.lastActivityAt]
  );
}

export async function updateCard(card: Card): Promise<void> {
  const d = await getDb();
  await d.execute(
    `UPDATE cards SET name=$1, description=$2, column_name=$3, column_order=$4,
     session_id=$5, state=$6, tags=$7, last_activity_at=$8 WHERE id=$9`,
    [card.name, card.description, card.columnName, card.columnOrder,
     card.sessionId, card.state, JSON.stringify(card.tags),
     card.lastActivityAt, card.id]
  );
}

export async function deleteCard(id: string): Promise<void> {
  const d = await getDb();
  await d.execute('DELETE FROM cards WHERE id = $1', [id]);
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
```

- [ ] **Step 2: Verify the app still compiles**

```bash
pnpm tauri dev
```

Expected: App builds without TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/services/database.ts
git commit -m "feat: add SQLite database service with migrations and CRUD"
```

---

### Task 4: Config loader service

**Files:**
- Create: `src/services/config-loader.ts`

- [ ] **Step 1: Write the YAML config loader with validation**

```typescript
// src/services/config-loader.ts
import { readTextFile, writeTextFile, exists, mkdir } from '@tauri-apps/plugin-fs';
import * as yaml from 'js-yaml';
import type { ProjectConfig, ColumnConfig, PipelineConfig } from '../types';

const CONFIG_DIR = '.claudban';
const CONFIG_FILE = '.claudban/config.yaml';

const DEFAULT_COLUMNS: ColumnConfig[] = [
  { name: 'Brainstorm', color: '#a78bfa' },
  { name: 'Specify', color: '#60a5fa' },
  { name: 'Plan', color: '#34d399' },
  { name: 'Implement', color: '#fbbf24' },
  { name: 'Review', color: '#f472b6' },
  { name: 'Done', color: '#22c55e' },
];

const DEFAULT_PIPELINES: PipelineConfig[] = [
  {
    from: 'Brainstorm', to: 'Specify',
    prompt: 'Based on our brainstorming in session {{session.name}}, create a formal specification.\nProject: {{project.path}}',
  },
  {
    from: 'Specify', to: 'Plan',
    prompt: 'Review the specification and create an implementation plan for {{session.name}}.',
  },
];

export async function loadProjectConfig(projectPath: string): Promise<ProjectConfig> {
  const configPath = `${projectPath}/${CONFIG_FILE}`;
  const configExists = await exists(configPath);

  if (!configExists) {
    return createDefaultConfig(projectPath);
  }

  const content = await readTextFile(configPath);
  const raw = yaml.load(content) as Record<string, unknown>;
  return validateConfig(raw);
}

async function createDefaultConfig(projectPath: string): Promise<ProjectConfig> {
  const config: ProjectConfig = {
    columns: DEFAULT_COLUMNS,
    pipelines: DEFAULT_PIPELINES,
  };

  const dirPath = `${projectPath}/${CONFIG_DIR}`;
  const dirExists = await exists(dirPath);
  if (!dirExists) {
    await mkdir(dirPath);
  }

  await saveProjectConfig(projectPath, config);
  return config;
}

export async function saveProjectConfig(
  projectPath: string, config: ProjectConfig
): Promise<void> {
  const configPath = `${projectPath}/${CONFIG_FILE}`;
  const content = yaml.dump(config, { lineWidth: 120 });
  await writeTextFile(configPath, content);
}

function validateConfig(raw: Record<string, unknown>): ProjectConfig {
  const columns = (raw.columns as ColumnConfig[]) || DEFAULT_COLUMNS;
  const pipelines = (raw.pipelines as PipelineConfig[]) || [];

  // Ensure unique, non-empty column names
  const uniqueColumns: ColumnConfig[] = [];
  const seenNames = new Set<string>();
  for (const col of columns) {
    if (col.name && !seenNames.has(col.name)) {
      seenNames.add(col.name);
      uniqueColumns.push(col);
    }
  }

  // Validate pipelines: reference existing columns, no duplicates
  const validPipelines: PipelineConfig[] = [];
  const seenTransitions = new Set<string>();
  for (const p of pipelines) {
    const key = `${p.from}->${p.to}`;
    if (seenNames.has(p.from) && seenNames.has(p.to) && !seenTransitions.has(key)) {
      seenTransitions.add(key);
      validPipelines.push(p);
    }
  }

  return { columns: uniqueColumns, pipelines: validPipelines };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/config-loader.ts
git commit -m "feat: add YAML config loader with validation for project configs"
```

---

### Task 5: Template engine service

**Files:**
- Create: `src/services/template-engine.ts`

- [ ] **Step 1: Write the template variable resolver**

```typescript
// src/services/template-engine.ts
import type { TemplateContext } from '../types';

export function resolveTemplate(
  template: string, context: TemplateContext
): string {
  return template.replace(/\{\{(\w+)\.(\w+)\}\}/g, (_match, group, key) => {
    const obj = context[group as keyof TemplateContext];
    if (obj && typeof obj === 'object' && key in obj) {
      return String((obj as Record<string, unknown>)[key]);
    }
    return _match; // Leave unresolved variables as-is
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/template-engine.ts
git commit -m "feat: add template engine for pipeline prompt variable resolution"
```

---

### Task 6: Stream parser service

**Files:**
- Create: `src/services/stream-parser.ts`

- [ ] **Step 1: Write the stream-json parser**

```typescript
// src/services/stream-parser.ts
import type { StreamMessage } from '../types';

export function parseStreamLine(line: string): StreamMessage | null {
  if (!line.trim()) return null;

  try {
    const data = JSON.parse(line);

    if (data.type === 'assistant' || data.type === 'text') {
      return {
        type: 'assistant',
        content: data.content || data.text || '',
        timestamp: Date.now(),
      };
    }

    if (data.type === 'user') {
      return {
        type: 'user',
        content: data.content || data.text || '',
        timestamp: Date.now(),
      };
    }

    if (data.type === 'tool_use') {
      return {
        type: 'tool_use',
        content: '',
        toolName: data.name || data.tool || '',
        toolInput: data.input || {},
        timestamp: Date.now(),
      };
    }

    if (data.type === 'tool_result') {
      return {
        type: 'tool_result',
        content: '',
        toolResult: typeof data.content === 'string'
          ? data.content
          : JSON.stringify(data.content),
        timestamp: Date.now(),
      };
    }

    if (data.type === 'system') {
      return {
        type: 'system',
        content: data.content || data.message || '',
        sessionId: data.session_id || undefined,
        timestamp: Date.now(),
      };
    }

    // Tool confirmation request (Claude awaiting user approval)
    if (data.type === 'tool_confirmation' || data.type === 'permission_request') {
      return {
        type: 'tool_confirmation',
        content: data.message || data.content || '',
        toolName: data.tool || data.name || '',
        toolInput: data.input || {},
        timestamp: Date.now(),
      };
    }

    // Unknown type — treat as system message
    return {
      type: 'system',
      content: JSON.stringify(data),
      timestamp: Date.now(),
    };
  } catch {
    // Non-JSON line — ignore
    return null;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/stream-parser.ts
git commit -m "feat: add stream-json parser for Claude Code output"
```

---

### Task 7: Claude process service

**Files:**
- Create: `src/services/claude-process.ts`

- [ ] **Step 1: Write the process manager**

```typescript
// src/services/claude-process.ts
import { Command } from '@tauri-apps/plugin-shell';
import type { StreamMessage } from '../types';
import { parseStreamLine } from './stream-parser';

export interface ClaudeProcess {
  sessionId: string;
  child: Awaited<ReturnType<Command['spawn']>>;
  onMessage: (msg: StreamMessage) => void;
  onExit: (code: number) => void;
}

const activeProcesses = new Map<string, ClaudeProcess>();

export function getActiveProcess(cardId: string): ClaudeProcess | undefined {
  return activeProcesses.get(cardId);
}

function setupCommand(
  cardId: string,
  command: ReturnType<typeof Command.create>,
  onMessage: (msg: StreamMessage) => void,
  onExit: (code: number) => void,
): void {
  command.stdout.on('data', (line: string) => {
    const msg = parseStreamLine(line);
    if (msg) onMessage(msg);
  });

  command.stderr.on('data', (line: string) => {
    const msg = parseStreamLine(line);
    if (msg) onMessage(msg);
  });

  command.on('close', (data) => {
    activeProcesses.delete(cardId);
    onExit(data.code);
  });

  command.on('error', (error) => {
    activeProcesses.delete(cardId);
    onMessage({
      type: 'system',
      content: `Process error: ${error}`,
      timestamp: Date.now(),
    });
    onExit(1);
  });
}

export async function checkClaudeBinary(claudeBinary: string): Promise<boolean> {
  try {
    const cmd = Command.create(claudeBinary, ['--version']);
    const output = await cmd.execute();
    return output.code === 0;
  } catch {
    return false;
  }
}

export async function spawnClaudeSession(
  cardId: string,
  projectPath: string,
  claudeBinary: string,
  onMessage: (msg: StreamMessage) => void,
  onExit: (code: number) => void,
): Promise<string> {
  const command = Command.create(claudeBinary, [
    '--output-format', 'stream-json',
    '--verbose',
  ], { cwd: projectPath });

  setupCommand(cardId, command, onMessage, onExit);
  const child = await command.spawn();

  // Session ID is extracted from the stream-json output.
  // Claude Code emits a system message with session_id at startup.
  // The sessions store watches for this in onMessage and calls
  // updateCardSessionId when detected. Use cardId as temporary placeholder.
  const sessionId = `pending-${cardId}`;

  const proc: ClaudeProcess = { sessionId, child, onMessage, onExit };
  activeProcesses.set(cardId, proc);

  return sessionId;
}

export async function resumeClaudeSession(
  cardId: string,
  sessionId: string,
  projectPath: string,
  claudeBinary: string,
  onMessage: (msg: StreamMessage) => void,
  onExit: (code: number) => void,
): Promise<void> {
  const command = Command.create(claudeBinary, [
    '--resume', sessionId,
    '--output-format', 'stream-json',
    '--verbose',
  ], { cwd: projectPath });

  setupCommand(cardId, command, onMessage, onExit);
  const child = await command.spawn();
  const proc: ClaudeProcess = { sessionId, child, onMessage, onExit };
  activeProcesses.set(cardId, proc);
}

export async function sendMessage(
  cardId: string, message: string
): Promise<void> {
  const proc = activeProcesses.get(cardId);
  if (!proc) throw new Error(`No active process for card ${cardId}`);
  // Claude Code stream-json input expects newline-delimited JSON or raw text.
  // Send as raw text followed by newline — Claude Code handles both formats.
  await proc.child.write(message + '\n');
}

export function updateSessionId(cardId: string, sessionId: string): void {
  const proc = activeProcesses.get(cardId);
  if (proc) {
    proc.sessionId = sessionId;
  }
}

export async function killProcess(cardId: string): Promise<void> {
  const proc = activeProcesses.get(cardId);
  if (proc) {
    await proc.child.kill();
    activeProcesses.delete(cardId);
  }
}

export function isProcessActive(cardId: string): boolean {
  return activeProcesses.has(cardId);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/claude-process.ts
git commit -m "feat: add Claude Code process manager with spawn/resume/kill"
```

---

## Chunk 2: State Management (Pinia Stores)

### Task 8: Settings store

**Files:**
- Create: `src/stores/settings.ts`

- [ ] **Step 1: Write the global settings store**

```typescript
// src/stores/settings.ts
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { readTextFile, writeTextFile, exists, mkdir } from '@tauri-apps/plugin-fs';
import { homeDir } from '@tauri-apps/api/path';
import * as yaml from 'js-yaml';
import type { GlobalSettings, ColumnConfig } from '../types';

const DEFAULT_SETTINGS: GlobalSettings = {
  claudeBinaryPath: 'claude',
  theme: 'dark',
  defaultColumns: [
    { name: 'Brainstorm', color: '#a78bfa' },
    { name: 'Specify', color: '#60a5fa' },
    { name: 'Plan', color: '#34d399' },
    { name: 'Implement', color: '#fbbf24' },
    { name: 'Review', color: '#f472b6' },
    { name: 'Done', color: '#22c55e' },
  ],
};

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<GlobalSettings>({ ...DEFAULT_SETTINGS });
  const loaded = ref(false);

  async function getSettingsPath(): Promise<string> {
    const home = await homeDir();
    return `${home}/.claudban`;
  }

  async function load(): Promise<void> {
    const dir = await getSettingsPath();
    const filePath = `${dir}/settings.yaml`;

    const dirExists = await exists(dir);
    if (!dirExists) {
      await mkdir(dir);
    }

    const fileExists = await exists(filePath);
    if (fileExists) {
      const content = await readTextFile(filePath);
      const raw = yaml.load(content) as Partial<GlobalSettings>;
      settings.value = { ...DEFAULT_SETTINGS, ...raw };
    }

    loaded.value = true;
  }

  async function save(): Promise<void> {
    const dir = await getSettingsPath();
    const filePath = `${dir}/settings.yaml`;
    const content = yaml.dump(settings.value, { lineWidth: 120 });
    await writeTextFile(filePath, content);
  }

  async function updateClaudePath(path: string): Promise<void> {
    settings.value.claudeBinaryPath = path;
    await save();
  }

  return { settings, loaded, load, save, updateClaudePath };
});
```

- [ ] **Step 2: Commit**

```bash
git add src/stores/settings.ts
git commit -m "feat: add global settings Pinia store with YAML persistence"
```

---

### Task 9: Projects store

**Files:**
- Create: `src/stores/projects.ts`

- [ ] **Step 1: Write the projects store**

```typescript
// src/stores/projects.ts
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { v4 as uuidv4 } from 'uuid';
import type { Project } from '../types';
import * as db from '../services/database';

export const useProjectsStore = defineStore('projects', () => {
  const projects = ref<Project[]>([]);
  const activeProjectId = ref<string | null>(null);

  const activeProject = computed(() =>
    projects.value.find(p => p.id === activeProjectId.value) || null
  );

  async function load(): Promise<void> {
    projects.value = await db.getAllProjects();
    if (projects.value.length > 0 && !activeProjectId.value) {
      activeProjectId.value = projects.value[0].id;
    }
  }

  async function addProject(name: string, path: string): Promise<Project> {
    const project: Project = {
      id: uuidv4(),
      name,
      path,
      createdAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
    };
    await db.insertProject(project);
    projects.value.push(project);
    activeProjectId.value = project.id;
    return project;
  }

  async function removeProject(id: string): Promise<void> {
    await db.deleteProject(id);
    projects.value = projects.value.filter(p => p.id !== id);
    if (activeProjectId.value === id) {
      activeProjectId.value = projects.value[0]?.id || null;
    }
  }

  async function setActive(id: string): Promise<void> {
    activeProjectId.value = id;
    await db.updateProjectLastOpened(id);
  }

  return { projects, activeProjectId, activeProject, load, addProject, removeProject, setActive };
});
```

- [ ] **Step 2: Commit**

```bash
git add src/stores/projects.ts
git commit -m "feat: add projects Pinia store with CRUD operations"
```

---

### Task 10: Pipelines store

**Files:**
- Create: `src/stores/pipelines.ts`

- [ ] **Step 1: Write the pipelines store**

```typescript
// src/stores/pipelines.ts
import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { ProjectConfig } from '../types';
import { loadProjectConfig, saveProjectConfig } from '../services/config-loader';

export const usePipelinesStore = defineStore('pipelines', () => {
  // Keyed by project path
  const configs = ref<Map<string, ProjectConfig>>(new Map());

  async function loadForProject(projectPath: string): Promise<ProjectConfig> {
    const config = await loadProjectConfig(projectPath);
    configs.value.set(projectPath, config);
    return config;
  }

  function getConfig(projectPath: string): ProjectConfig | undefined {
    return configs.value.get(projectPath);
  }

  function findPipeline(projectPath: string, from: string, to: string) {
    const config = configs.value.get(projectPath);
    if (!config) return undefined;
    return config.pipelines.find(p => p.from === from && p.to === to);
  }

  async function saveConfig(projectPath: string, config: ProjectConfig): Promise<void> {
    configs.value.set(projectPath, config);
    await saveProjectConfig(projectPath, config);
  }

  return { configs, loadForProject, getConfig, findPipeline, saveConfig };
});
```

- [ ] **Step 2: Commit**

```bash
git add src/stores/pipelines.ts
git commit -m "feat: add pipelines Pinia store for project config management"
```

---

### Task 11: Cards store

**Files:**
- Create: `src/stores/cards.ts`

- [ ] **Step 1: Write the cards store**

```typescript
// src/stores/cards.ts
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { v4 as uuidv4 } from 'uuid';
import type { Card } from '../types';
import * as db from '../services/database';

export const useCardsStore = defineStore('cards', () => {
  const cards = ref<Card[]>([]);
  const loadedProjectId = ref<string | null>(null);

  function cardsByColumn(columnName: string): Card[] {
    return cards.value
      .filter(c => c.columnName === columnName)
      .sort((a, b) => {
        // Manual order takes precedence if set, otherwise sort by last activity (most recent first)
        if (a.columnOrder !== b.columnOrder) return a.columnOrder - b.columnOrder;
        return new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime();
      });
  }

  async function loadForProject(projectId: string): Promise<void> {
    cards.value = await db.getCardsByProject(projectId);
    loadedProjectId.value = projectId;
  }

  async function addCard(
    projectId: string, columnName: string, name: string, description: string
  ): Promise<Card> {
    const columnCards = cards.value.filter(c => c.columnName === columnName);
    const card: Card = {
      id: uuidv4(),
      projectId,
      name,
      description,
      columnName,
      columnOrder: columnCards.length,
      sessionId: '',
      state: 'idle',
      tags: [],
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    };
    await db.insertCard(card);
    cards.value.push(card);
    return card;
  }

  async function moveCard(
    cardId: string, toColumn: string, newOrder: number
  ): Promise<void> {
    const card = cards.value.find(c => c.id === cardId);
    if (!card) return;
    card.columnName = toColumn;
    card.columnOrder = newOrder;
    card.lastActivityAt = new Date().toISOString();
    await db.updateCard(card);
  }

  async function updateCardState(
    cardId: string, state: Card['state']
  ): Promise<void> {
    const card = cards.value.find(c => c.id === cardId);
    if (!card) return;
    card.state = state;
    card.lastActivityAt = new Date().toISOString();
    await db.updateCard(card);
  }

  async function updateCardSessionId(
    cardId: string, sessionId: string
  ): Promise<void> {
    const card = cards.value.find(c => c.id === cardId);
    if (!card) return;
    card.sessionId = sessionId;
    await db.updateCard(card);
  }

  async function reorderColumn(
    columnName: string, cardIds: string[]
  ): Promise<void> {
    await db.updateCardsColumn(cardIds, columnName);
    for (let i = 0; i < cardIds.length; i++) {
      const card = cards.value.find(c => c.id === cardIds[i]);
      if (card) {
        card.columnName = columnName;
        card.columnOrder = i;
      }
    }
  }

  async function removeCard(cardId: string): Promise<void> {
    await db.deleteCard(cardId);
    cards.value = cards.value.filter(c => c.id !== cardId);
  }

  return {
    cards, loadedProjectId, cardsByColumn, loadForProject,
    addCard, moveCard, updateCardState, updateCardSessionId,
    reorderColumn, removeCard,
  };
});
```

- [ ] **Step 2: Commit**

```bash
git add src/stores/cards.ts
git commit -m "feat: add cards Pinia store with move, reorder, state management"
```

---

### Task 12: Sessions store

**Files:**
- Create: `src/stores/sessions.ts`

- [ ] **Step 1: Write the sessions store (orchestrates Claude processes)**

```typescript
// src/stores/sessions.ts
import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { StreamMessage } from '../types';
import {
  spawnClaudeSession, resumeClaudeSession,
  sendMessage, killProcess, isProcessActive,
  checkClaudeBinary, updateSessionId,
} from '../services/claude-process';
import { useCardsStore } from './cards';
import { useSettingsStore } from './settings';

export const useSessionsStore = defineStore('sessions', () => {
  // Message history keyed by card ID
  const messages = ref<Map<string, StreamMessage[]>>(new Map());
  const activeChatCardId = ref<string | null>(null);

  function getMessages(cardId: string): StreamMessage[] {
    return messages.value.get(cardId) || [];
  }

  function appendMessage(cardId: string, msg: StreamMessage): void {
    if (!messages.value.has(cardId)) {
      messages.value.set(cardId, []);
    }
    messages.value.get(cardId)!.push(msg);
  }

  const claudeAvailable = ref<boolean | null>(null);
  const claudeError = ref<string | null>(null);

  async function verifyClaudeBinary(): Promise<boolean> {
    const settingsStore = useSettingsStore();
    const available = await checkClaudeBinary(settingsStore.settings.claudeBinaryPath);
    claudeAvailable.value = available;
    if (!available) {
      claudeError.value = 'Claude Code not found. Install it or configure the binary path in Settings.';
    } else {
      claudeError.value = null;
    }
    return available;
  }

  async function startSession(
    cardId: string, projectPath: string
  ): Promise<string> {
    const settingsStore = useSettingsStore();
    const cardsStore = useCardsStore();
    const claudeBinary = settingsStore.settings.claudeBinaryPath;

    if (!await verifyClaudeBinary()) {
      throw new Error(claudeError.value || 'Claude Code not available');
    }

    const sessionId = await spawnClaudeSession(
      cardId,
      projectPath,
      claudeBinary,
      (msg) => {
        appendMessage(cardId, msg);
        // Capture real session ID from initial system message
        if (msg.sessionId) {
          updateSessionId(cardId, msg.sessionId);
          cardsStore.updateCardSessionId(cardId, msg.sessionId);
        }
      },
      (code) => {
        cardsStore.updateCardState(cardId, code === 0 ? 'idle' : 'error');
      },
    );

    await cardsStore.updateCardState(cardId, 'active');
    await cardsStore.updateCardSessionId(cardId, sessionId);
    return sessionId;
  }

  async function resumeSession(
    cardId: string, sessionId: string, projectPath: string
  ): Promise<void> {
    const settingsStore = useSettingsStore();
    const cardsStore = useCardsStore();
    const claudeBinary = settingsStore.settings.claudeBinaryPath;

    await resumeClaudeSession(
      cardId,
      sessionId,
      projectPath,
      claudeBinary,
      (msg) => {
        appendMessage(cardId, msg);
      },
      (code) => {
        cardsStore.updateCardState(cardId, code === 0 ? 'idle' : 'error');
      },
    );

    await cardsStore.updateCardState(cardId, 'active');
  }

  async function send(cardId: string, message: string): Promise<void> {
    appendMessage(cardId, {
      type: 'user',
      content: message,
      timestamp: Date.now(),
    });
    await sendMessage(cardId, message);

    const cardsStore = useCardsStore();
    const card = cardsStore.cards.find(c => c.id === cardId);
    if (card) {
      card.lastActivityAt = new Date().toISOString();
    }
  }

  async function stopSession(cardId: string): Promise<void> {
    await killProcess(cardId);
    const cardsStore = useCardsStore();
    await cardsStore.updateCardState(cardId, 'idle');
  }

  function openChat(cardId: string): void {
    activeChatCardId.value = cardId;
  }

  function closeChat(): void {
    activeChatCardId.value = null;
  }

  function isActive(cardId: string): boolean {
    return isProcessActive(cardId);
  }

  return {
    messages, activeChatCardId, claudeAvailable, claudeError,
    getMessages, verifyClaudeBinary, startSession,
    resumeSession, send, stopSession, openChat, closeChat, isActive,
  };
});
```

- [ ] **Step 2: Commit**

```bash
git add src/stores/sessions.ts
git commit -m "feat: add sessions Pinia store orchestrating Claude processes"
```

---

## Chunk 3: UI Components

### Task 13: Global styles and App shell

**Files:**
- Create: `src/assets/main.css`
- Modify: `src/App.vue`
- Modify: `src/main.ts`

- [ ] **Step 1: Write dark theme CSS**

```css
/* src/assets/main.css */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

:root {
  --bg-primary: #0f172a;
  --bg-secondary: #1e293b;
  --bg-tertiary: #334155;
  --text-primary: #e2e8f0;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;
  --border: #475569;
  --accent: #3b82f6;
  --success: #22c55e;
  --warning: #fbbf24;
  --error: #ef4444;
  --panel-width: 400px;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  overflow: hidden;
  height: 100vh;
}

#app {
  height: 100vh;
  display: flex;
  flex-direction: column;
}

::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: var(--bg-tertiary);
  border-radius: 3px;
}

button {
  cursor: pointer;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
}

input, textarea {
  font: inherit;
  color: inherit;
}
```

- [ ] **Step 2: Update `src/main.ts` with Pinia and styles**

```typescript
// src/main.ts
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import './assets/main.css';

const app = createApp(App);
app.use(createPinia());
app.mount('#app');
```

- [ ] **Step 3: Write `src/App.vue` shell**

```vue
<!-- src/App.vue -->
<script setup lang="ts">
import { onMounted, computed } from 'vue';
import { useProjectsStore } from './stores/projects';
import { useSettingsStore } from './stores/settings';
import { useCardsStore } from './stores/cards';
import { usePipelinesStore } from './stores/pipelines';
import { useSessionsStore } from './stores/sessions';
import TabBar from './components/TabBar.vue';
import KanbanBoard from './components/KanbanBoard.vue';
import ChatPanel from './components/ChatPanel.vue';

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
      <KanbanBoard v-if="projectsStore.activeProject" />
      <div v-else class="empty-state">
        <p>Add a project to get started</p>
      </div>
    </div>
    <ChatPanel v-if="showChat" />
  </div>
</template>

<style scoped>
.main-content {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.board-area {
  flex: 1;
  overflow-x: auto;
  overflow-y: hidden;
}

.main-content.with-chat .board-area {
  flex: 1;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
  font-size: 1.1rem;
}
</style>
```

- [ ] **Step 4: Commit**

```bash
git add src/assets/main.css src/main.ts src/App.vue
git commit -m "feat: add app shell with dark theme, Pinia, and split layout"
```

---

### Task 14: StatusIndicator component

**Files:**
- Create: `src/components/StatusIndicator.vue`

- [ ] **Step 1: Write the status dot component**

```vue
<!-- src/components/StatusIndicator.vue -->
<script setup lang="ts">
import type { CardState } from '../types';

const props = defineProps<{ state: CardState }>();

const colorMap: Record<CardState, string> = {
  active: 'var(--success)',
  idle: 'var(--text-muted)',
  error: 'var(--error)',
  completed: 'transparent',
};
</script>

<template>
  <span
    class="status-dot"
    :class="{ pulse: props.state === 'active' }"
    :style="{ backgroundColor: colorMap[props.state] }"
    :title="props.state"
  />
</template>

<style scoped>
.status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.pulse {
  animation: pulse 2s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/StatusIndicator.vue
git commit -m "feat: add StatusIndicator component with animated pulse"
```

---

### Task 15: TabBar component

**Files:**
- Create: `src/components/TabBar.vue`

- [ ] **Step 1: Write the tab bar with project tabs and add button**

```vue
<!-- src/components/TabBar.vue -->
<script setup lang="ts">
import { useProjectsStore } from '../stores/projects';
import { useCardsStore } from '../stores/cards';
import { usePipelinesStore } from '../stores/pipelines';
import { open } from '@tauri-apps/plugin-dialog';
import { basename } from '@tauri-apps/api/path';

const projectsStore = useProjectsStore();
const cardsStore = useCardsStore();
const pipelinesStore = usePipelinesStore();

async function switchProject(projectId: string) {
  await projectsStore.setActive(projectId);
  const project = projectsStore.activeProject;
  if (project) {
    await cardsStore.loadForProject(project.id);
    await pipelinesStore.loadForProject(project.path);
  }
}

async function addProject() {
  const selected = await open({ directory: true, multiple: false });
  if (!selected) return;
  const path = selected as string;
  const name = await basename(path);
  const project = await projectsStore.addProject(name, path);
  await cardsStore.loadForProject(project.id);
  await pipelinesStore.loadForProject(project.path);
}
</script>

<template>
  <div class="tab-bar">
    <button
      v-for="project in projectsStore.projects"
      :key="project.id"
      class="tab"
      :class="{ active: project.id === projectsStore.activeProjectId }"
      @click="switchProject(project.id)"
    >
      {{ project.name }}
    </button>
    <button class="tab add-tab" @click="addProject">+</button>
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
  padding: 6px 16px;
  border-radius: 6px 6px 0 0;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  -webkit-app-region: no-drag;
  transition: background 0.15s;
}
.tab:hover {
  background: var(--bg-tertiary);
}
.tab.active {
  background: var(--bg-primary);
  color: var(--text-primary);
}
.add-tab {
  color: var(--text-muted);
  font-size: 16px;
  padding: 4px 12px;
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/TabBar.vue
git commit -m "feat: add TabBar component with project tabs and directory picker"
```

---

### Task 16: KanbanCard component

**Files:**
- Create: `src/components/KanbanCard.vue`

- [ ] **Step 1: Write the card component**

```vue
<!-- src/components/KanbanCard.vue -->
<script setup lang="ts">
import type { Card } from '../types';
import StatusIndicator from './StatusIndicator.vue';
import { useSessionsStore } from '../stores/sessions';
import { computed } from 'vue';

const props = defineProps<{ card: Card; columnColor: string }>();
const sessionsStore = useSessionsStore();

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function openChat() {
  sessionsStore.openChat(props.card.id);
}
</script>

<template>
  <div
    class="kanban-card"
    :style="{ borderLeftColor: props.columnColor }"
    @click="openChat"
  >
    <div class="card-header">
      <span class="card-name">{{ card.name }}</span>
      <StatusIndicator :state="card.state" />
    </div>
    <p v-if="card.description" class="card-desc">{{ card.description }}</p>
    <div class="card-footer">
      <span class="card-meta">{{ timeAgo(card.lastActivityAt) }}</span>
      <div class="card-tags">
        <span v-for="tag in card.tags" :key="tag" class="tag">{{ tag }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.kanban-card {
  background: var(--bg-secondary);
  border-left: 3px solid;
  border-radius: 6px;
  padding: 10px;
  cursor: pointer;
  transition: background 0.15s;
}
.kanban-card:hover {
  background: var(--bg-tertiary);
}
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}
.card-name {
  font-size: 13px;
  font-weight: 600;
}
.card-desc {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.card-meta {
  font-size: 11px;
  color: var(--text-muted);
}
.card-tags {
  display: flex;
  gap: 4px;
}
.tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/KanbanCard.vue
git commit -m "feat: add KanbanCard component with status, time ago, tags"
```

---

### Task 17: NewSessionDialog component

**Files:**
- Create: `src/components/NewSessionDialog.vue`

- [ ] **Step 1: Write the new session modal**

```vue
<!-- src/components/NewSessionDialog.vue -->
<script setup lang="ts">
import { ref } from 'vue';

const emit = defineEmits<{
  create: [name: string, description: string];
  cancel: [];
}>();

const name = ref('');
const description = ref('');

function submit() {
  if (!name.value.trim()) return;
  emit('create', name.value.trim(), description.value.trim());
  name.value = '';
  description.value = '';
}
</script>

<template>
  <div class="dialog-overlay" @click.self="emit('cancel')">
    <div class="dialog">
      <h3>New Session</h3>
      <label>
        Name
        <input v-model="name" placeholder="e.g. Auth Feature" autofocus @keydown.enter="submit" />
      </label>
      <label>
        Description (optional)
        <input v-model="description" placeholder="Brief description..." @keydown.enter="submit" />
      </label>
      <div class="dialog-actions">
        <button class="btn-secondary" @click="emit('cancel')">Cancel</button>
        <button class="btn-primary" :disabled="!name.trim()" @click="submit">Create</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.dialog {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 20px;
  width: 360px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.dialog h3 {
  font-size: 16px;
  margin-bottom: 4px;
}
label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-secondary);
}
input {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 8px;
  font-size: 13px;
}
input:focus {
  outline: none;
  border-color: var(--accent);
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
.btn-primary {
  background: var(--accent);
  color: white;
  padding: 6px 16px;
  border-radius: 4px;
  font-size: 13px;
}
.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-secondary {
  padding: 6px 16px;
  border-radius: 4px;
  font-size: 13px;
  color: var(--text-secondary);
}
.btn-secondary:hover {
  background: var(--bg-tertiary);
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/NewSessionDialog.vue
git commit -m "feat: add NewSessionDialog modal component"
```

---

### Task 18: KanbanColumn component

**Files:**
- Create: `src/components/KanbanColumn.vue`

- [ ] **Step 1: Write the column with draggable cards**

```vue
<!-- src/components/KanbanColumn.vue -->
<script setup lang="ts">
import { ref, computed } from 'vue';
import { vDraggable } from 'vue-draggable-plus';
import type { ColumnConfig, Card } from '../types';
import { useCardsStore } from '../stores/cards';
import { useProjectsStore } from '../stores/projects';
import { useSessionsStore } from '../stores/sessions';
import { usePipelinesStore } from '../stores/pipelines';
import { resolveTemplate } from '../services/template-engine';
import KanbanCard from './KanbanCard.vue';
import NewSessionDialog from './NewSessionDialog.vue';

const props = defineProps<{ column: ColumnConfig }>();
const cardsStore = useCardsStore();
const projectsStore = useProjectsStore();
const sessionsStore = useSessionsStore();
const pipelinesStore = usePipelinesStore();

const showNewDialog = ref(false);

const columnCards = computed(() => cardsStore.cardsByColumn(props.column.name));

async function onAdd(evt: { item: { dataset: { cardId: string }; }; newIndex: number }) {
  // Card was dropped into this column from another
  const cardId = evt.item.dataset.cardId;
  const card = cardsStore.cards.find(c => c.id === cardId);
  if (!card) return;

  const fromColumn = card.columnName;
  await cardsStore.moveCard(cardId, props.column.name, evt.newIndex);

  // Check for pipeline trigger
  const project = projectsStore.activeProject;
  if (!project) return;

  const pipeline = pipelinesStore.findPipeline(project.path, fromColumn, props.column.name);
  if (pipeline) {
    // Auto-resume if idle
    if (card.state === 'idle' && card.sessionId) {
      await sessionsStore.resumeSession(cardId, card.sessionId, project.path);
    } else if (!card.sessionId) {
      await sessionsStore.startSession(cardId, project.path);
    }

    // Resolve and send pipeline prompt
    const prompt = resolveTemplate(pipeline.prompt, {
      session: { name: card.name, id: card.sessionId },
      project: { path: project.path, name: project.name },
      card: { description: card.description },
      column: { from: fromColumn, to: props.column.name },
    });

    await sessionsStore.send(cardId, prompt);
    sessionsStore.openChat(cardId);
  }
}

function onUpdate() {
  // Reorder within column
  const ids = columnCards.value.map(c => c.id);
  cardsStore.reorderColumn(props.column.name, ids);
}

async function createSession(name: string, description: string) {
  showNewDialog.value = false;
  const project = projectsStore.activeProject;
  if (!project) return;

  const card = await cardsStore.addCard(project.id, props.column.name, name, description);
  await sessionsStore.startSession(card.id, project.path);
  sessionsStore.openChat(card.id);
}
</script>

<template>
  <div class="kanban-column">
    <div class="column-header">
      <div class="column-title">
        <span class="color-dot" :style="{ background: column.color }" />
        <span>{{ column.name }}</span>
        <span class="card-count">{{ columnCards.length }}</span>
      </div>
      <button class="add-btn" @click="showNewDialog = true" title="New session">+</button>
    </div>

    <div
      v-draggable="[
        columnCards,
        {
          animation: 150,
          ghostClass: 'ghost',
          group: 'kanban',
          onAdd,
          onUpdate,
        }
      ]"
      class="column-body"
    >
      <KanbanCard
        v-for="card in columnCards"
        :key="card.id"
        :card="card"
        :column-color="column.color"
        :data-card-id="card.id"
      />
    </div>

    <NewSessionDialog
      v-if="showNewDialog"
      @create="createSession"
      @cancel="showNewDialog = false"
    />
  </div>
</template>

<style scoped>
.kanban-column {
  min-width: 260px;
  max-width: 300px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  border-radius: 8px;
  border: 1px solid var(--bg-tertiary);
  height: 100%;
}
.column-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid var(--bg-tertiary);
}
.column-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
}
.color-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.card-count {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 400;
}
.add-btn {
  font-size: 18px;
  color: var(--text-muted);
  padding: 0 4px;
  border-radius: 4px;
}
.add-btn:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}
.column-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 100px;
}
.ghost {
  opacity: 0.4;
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/KanbanColumn.vue
git commit -m "feat: add KanbanColumn with drag-drop and pipeline trigger on card move"
```

---

### Task 19: KanbanBoard component

**Files:**
- Create: `src/components/KanbanBoard.vue`

- [ ] **Step 1: Write the board container**

```vue
<!-- src/components/KanbanBoard.vue -->
<script setup lang="ts">
import { computed } from 'vue';
import { useProjectsStore } from '../stores/projects';
import { usePipelinesStore } from '../stores/pipelines';
import KanbanColumn from './KanbanColumn.vue';

const projectsStore = useProjectsStore();
const pipelinesStore = usePipelinesStore();

const columns = computed(() => {
  const project = projectsStore.activeProject;
  if (!project) return [];
  const config = pipelinesStore.getConfig(project.path);
  return config?.columns || [];
});
</script>

<template>
  <div class="kanban-board">
    <KanbanColumn
      v-for="col in columns"
      :key="col.name"
      :column="col"
    />
  </div>
</template>

<style scoped>
.kanban-board {
  display: flex;
  gap: 12px;
  padding: 16px;
  height: 100%;
  overflow-x: auto;
  align-items: stretch;
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/KanbanBoard.vue
git commit -m "feat: add KanbanBoard container component"
```

---

### Task 20: ChatMessage and ToolCallBlock components

**Files:**
- Create: `src/components/ChatMessage.vue`
- Create: `src/components/ToolCallBlock.vue`

- [ ] **Step 1: Write ChatMessage component**

```vue
<!-- src/components/ChatMessage.vue -->
<script setup lang="ts">
import type { StreamMessage } from '../types';

defineProps<{ message: StreamMessage }>();
</script>

<template>
  <div class="chat-message" :class="message.type">
    <div v-if="message.type === 'assistant'" class="msg-bubble assistant">
      <span class="msg-role">Claude</span>
      <div class="msg-content">{{ message.content }}</div>
    </div>
    <div v-else-if="message.type === 'user'" class="msg-bubble user">
      <span class="msg-role">You</span>
      <div class="msg-content">{{ message.content }}</div>
    </div>
    <div v-else-if="message.type === 'system'" class="msg-system">
      {{ message.content }}
    </div>
  </div>
</template>

<style scoped>
.msg-bubble {
  padding: 8px 12px;
  border-radius: 6px;
  max-width: 90%;
}
.msg-bubble.assistant {
  background: var(--bg-secondary);
  align-self: flex-start;
}
.msg-bubble.user {
  background: var(--accent);
  color: white;
  align-self: flex-end;
  margin-left: auto;
}
.msg-role {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 2px;
  display: block;
}
.user .msg-role {
  color: rgba(255,255,255,0.7);
}
.msg-content {
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
.msg-system {
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
  padding: 4px;
  font-style: italic;
}
</style>
```

- [ ] **Step 2: Write ToolCallBlock component**

```vue
<!-- src/components/ToolCallBlock.vue -->
<script setup lang="ts">
import { ref } from 'vue';
import type { StreamMessage } from '../types';
import { useSessionsStore } from '../stores/sessions';

const props = defineProps<{ message: StreamMessage; cardId: string }>();
const expanded = ref(false);
const sessionsStore = useSessionsStore();

async function approve() {
  await sessionsStore.send(props.cardId, 'y');
}

async function reject() {
  await sessionsStore.send(props.cardId, 'n');
}
</script>

<template>
  <div class="tool-block" @click="expanded = !expanded">
    <div class="tool-header">
      <span class="tool-icon">{{ expanded ? '▼' : '▶' }}</span>
      <span class="tool-name">{{ message.toolName }}</span>
      <span v-if="message.type === 'tool_result'" class="tool-badge">result</span>
      <span v-if="message.type === 'tool_confirmation'" class="tool-badge confirm">approval needed</span>
    </div>
    <div v-if="message.type === 'tool_confirmation'" class="tool-confirm">
      <p class="confirm-msg">{{ message.content }}</p>
      <div class="confirm-actions">
        <button class="btn-approve" @click.stop="approve">Approve</button>
        <button class="btn-reject" @click.stop="reject">Reject</button>
      </div>
    </div>
    <div v-if="expanded" class="tool-detail">
      <pre v-if="message.toolInput">{{ JSON.stringify(message.toolInput, null, 2) }}</pre>
      <pre v-if="message.toolResult" class="tool-result">{{ message.toolResult }}</pre>
    </div>
  </div>
</template>

<style scoped>
.tool-block {
  background: var(--bg-secondary);
  border: 1px solid var(--bg-tertiary);
  border-radius: 4px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 12px;
}
.tool-header {
  display: flex;
  align-items: center;
  gap: 6px;
}
.tool-icon {
  font-size: 10px;
  color: var(--text-muted);
}
.tool-name {
  color: var(--warning);
  font-family: monospace;
}
.tool-badge {
  font-size: 10px;
  background: var(--bg-tertiary);
  padding: 1px 6px;
  border-radius: 3px;
  color: var(--text-secondary);
}
.tool-confirm { padding: 8px 0; }
.confirm-msg { font-size: 12px; color: var(--text-secondary); margin-bottom: 8px; }
.confirm-actions { display: flex; gap: 8px; }
.btn-approve { background: var(--success); color: white; padding: 4px 12px; border-radius: 4px; font-size: 12px; }
.btn-reject { background: var(--error); color: white; padding: 4px 12px; border-radius: 4px; font-size: 12px; }
.tool-badge.confirm { background: var(--warning); color: #000; }
.tool-detail {
  margin-top: 8px;
}
pre {
  font-size: 11px;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 200px;
  overflow-y: auto;
}
.tool-result {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--bg-tertiary);
}
</style>
```

- [ ] **Step 3: Commit**

```bash
git add src/components/ChatMessage.vue src/components/ToolCallBlock.vue
git commit -m "feat: add ChatMessage and ToolCallBlock display components"
```

---

### Task 21: ChatPanel component

**Files:**
- Create: `src/components/ChatPanel.vue`

- [ ] **Step 1: Write the chat panel**

```vue
<!-- src/components/ChatPanel.vue -->
<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { useSessionsStore } from '../stores/sessions';
import { useCardsStore } from '../stores/cards';
import { useProjectsStore } from '../stores/projects';
import ChatMessage from './ChatMessage.vue';
import ToolCallBlock from './ToolCallBlock.vue';

const sessionsStore = useSessionsStore();
const cardsStore = useCardsStore();
const projectsStore = useProjectsStore();

const input = ref('');
const messagesContainer = ref<HTMLElement | null>(null);

const card = computed(() => {
  if (!sessionsStore.activeChatCardId) return null;
  return cardsStore.cards.find(c => c.id === sessionsStore.activeChatCardId) || null;
});

const messages = computed(() => {
  if (!sessionsStore.activeChatCardId) return [];
  return sessionsStore.getMessages(sessionsStore.activeChatCardId);
});

watch(messages, async () => {
  await nextTick();
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
}, { deep: true });

async function sendMessage() {
  if (!input.value.trim() || !sessionsStore.activeChatCardId) return;
  const cardId = sessionsStore.activeChatCardId;
  const c = card.value;

  // Start or resume session if needed
  if (c && c.state !== 'active') {
    const project = projectsStore.activeProject;
    if (!project) return;
    if (c.sessionId) {
      await sessionsStore.resumeSession(cardId, c.sessionId, project.path);
    } else {
      await sessionsStore.startSession(cardId, project.path);
    }
  }

  await sessionsStore.send(cardId, input.value.trim());
  input.value = '';
}
</script>

<template>
  <div class="chat-panel">
    <div class="chat-header">
      <div class="chat-title">
        <strong>{{ card?.name || 'Session' }}</strong>
        <span class="chat-phase">{{ card?.columnName }}</span>
      </div>
      <button class="close-btn" @click="sessionsStore.closeChat()">x</button>
    </div>

    <div ref="messagesContainer" class="chat-messages">
      <template v-for="(msg, i) in messages" :key="i">
        <ToolCallBlock
          v-if="msg.type === 'tool_use' || msg.type === 'tool_result' || msg.type === 'tool_confirmation'"
          :message="msg"
          :card-id="sessionsStore.activeChatCardId!"
        />
        <ChatMessage v-else :message="msg" />
      </template>
      <div v-if="!messages.length" class="empty-chat">
        Start chatting to begin the session
      </div>
    </div>

    <div class="chat-input-area">
      <textarea
        v-model="input"
        placeholder="Type a message..."
        rows="2"
        @keydown.enter.exact.prevent="sendMessage"
      />
      <button class="send-btn" :disabled="!input.trim()" @click="sendMessage">Send</button>
    </div>
  </div>
</template>

<style scoped>
.chat-panel {
  width: var(--panel-width);
  min-width: 320px;
  max-width: 600px;
  border-left: 1px solid var(--border);
  background: var(--bg-primary);
  display: flex;
  flex-direction: column;
  resize: horizontal;
  overflow: hidden;
}
.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-secondary);
}
.chat-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.chat-phase {
  font-size: 11px;
  color: var(--text-muted);
  background: var(--bg-tertiary);
  padding: 2px 8px;
  border-radius: 3px;
}
.close-btn {
  font-size: 16px;
  color: var(--text-muted);
  padding: 2px 6px;
  border-radius: 4px;
}
.close-btn:hover {
  background: var(--bg-tertiary);
}
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.empty-chat {
  text-align: center;
  color: var(--text-muted);
  margin-top: 40%;
  font-size: 13px;
}
.chat-input-area {
  padding: 10px;
  border-top: 1px solid var(--border);
  display: flex;
  gap: 8px;
}
textarea {
  flex: 1;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px;
  font-size: 13px;
  resize: none;
}
textarea:focus {
  outline: none;
  border-color: var(--accent);
}
.send-btn {
  background: var(--accent);
  color: white;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  align-self: flex-end;
}
.send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ChatPanel.vue
git commit -m "feat: add ChatPanel with messages, tool calls, and auto-resume"
```

---

## Chunk 4: Integration and Polish

### Task 22: Wire up Tauri shell permissions

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Add shell scope for claude binary**

In `src-tauri/capabilities/default.json`, ensure the shell plugin has a scope that allows executing the `claude` command. Add under permissions:

```json
{
  "identifier": "shell:allow-spawn",
  "allow": [
    { "name": "claude", "cmd": "claude", "args": true },
    { "name": "claude-custom", "cmd": "*", "args": true }
  ]
}
```

Note: The exact scoping depends on Tauri v2 shell plugin ACL. The `claude-custom` entry allows a user-configured binary path. Adjust based on actual Tauri v2 shell plugin scope format after testing.

- [ ] **Step 2: Verify shell spawning works**

```bash
pnpm tauri dev
```

Open the app, add a project, create a session, and verify the Claude Code process spawns (check console for output).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/
git commit -m "feat: configure Tauri shell plugin scope for claude binary"
```

---

### Task 23: End-to-end smoke test

- [ ] **Step 1: Build and run the complete app**

```bash
pnpm tauri dev
```

- [ ] **Step 2: Manual verification checklist**

1. App opens with empty state ("Add a project to get started")
2. Click "+" tab → native directory picker opens
3. Select a project directory → tab appears, Kanban board loads with default columns
4. `.claudban/config.yaml` is created in the project directory
5. Click "+" in a column → New Session dialog appears
6. Create a session → card appears, chat panel opens, Claude process starts
7. Type a message → message appears in chat, Claude responds
8. Close chat panel → card still shows green dot (process running)
9. Drag card from one column to another → pipeline prompt fires (if configured)
10. Process completes → card shows gray dot (idle)

- [ ] **Step 3: Fix any issues found during testing**

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues from end-to-end smoke test"
```

---

### Task 24: Project settings UI (column and pipeline editors)

**Files:**
- Create: `src/components/ProjectSettings.vue`
- Create: `src/components/ColumnEditor.vue`
- Create: `src/components/PipelineEditor.vue`

- [ ] **Step 1: Write ColumnEditor component**

```vue
<!-- src/components/ColumnEditor.vue -->
<script setup lang="ts">
import { ref } from 'vue';
import type { ColumnConfig } from '../types';

const props = defineProps<{ columns: ColumnConfig[] }>();
const emit = defineEmits<{
  update: [columns: ColumnConfig[]];
  'column-removed': [name: string];
  'column-renamed': [oldName: string, newName: string];
}>();

const localColumns = ref<ColumnConfig[]>([...props.columns]);

function addColumn() {
  localColumns.value.push({ name: 'New Column', color: '#94a3b8' });
  emit('update', localColumns.value);
}

function removeColumn(index: number) {
  const colName = localColumns.value[index].name;
  // Emit with info about which column was removed so parent can migrate cards
  localColumns.value.splice(index, 1);
  emit('update', localColumns.value);
  emit('column-removed', colName);
}

function updateColumn(index: number, field: keyof ColumnConfig, value: string) {
  const oldName = localColumns.value[index].name;
  localColumns.value[index] = { ...localColumns.value[index], [field]: value };
  emit('update', localColumns.value);
  // If name changed, emit rename event so parent can update pipeline references
  if (field === 'name' && oldName !== value) {
    emit('column-renamed', oldName, value);
  }
}
</script>

<template>
  <div class="column-editor">
    <h4>Columns</h4>
    <div v-for="(col, i) in localColumns" :key="i" class="column-row">
      <input type="color" :value="col.color" @input="updateColumn(i, 'color', ($event.target as HTMLInputElement).value)" />
      <input :value="col.name" @input="updateColumn(i, 'name', ($event.target as HTMLInputElement).value)" />
      <button @click="removeColumn(i)" class="remove-btn">x</button>
    </div>
    <button class="add-column-btn" @click="addColumn">+ Add Column</button>
  </div>
</template>

<style scoped>
.column-editor { display: flex; flex-direction: column; gap: 8px; }
h4 { font-size: 14px; color: var(--text-primary); }
.column-row { display: flex; gap: 8px; align-items: center; }
.column-row input[type="color"] { width: 32px; height: 32px; border: none; border-radius: 4px; cursor: pointer; }
.column-row input[type="text"], .column-row input:not([type]) {
  flex: 1; background: var(--bg-primary); border: 1px solid var(--border);
  border-radius: 4px; padding: 6px 8px; font-size: 13px;
}
.remove-btn { color: var(--error); font-size: 14px; padding: 4px 8px; border-radius: 4px; }
.remove-btn:hover { background: rgba(239, 68, 68, 0.1); }
.add-column-btn { color: var(--accent); font-size: 13px; padding: 6px; border-radius: 4px; text-align: left; }
.add-column-btn:hover { background: var(--bg-tertiary); }
</style>
```

- [ ] **Step 2: Write PipelineEditor component**

```vue
<!-- src/components/PipelineEditor.vue -->
<script setup lang="ts">
import { ref } from 'vue';
import type { PipelineConfig, ColumnConfig } from '../types';

const props = defineProps<{ pipelines: PipelineConfig[]; columns: ColumnConfig[] }>();
const emit = defineEmits<{ update: [pipelines: PipelineConfig[]] }>();

const localPipelines = ref<PipelineConfig[]>([...props.pipelines]);

function addPipeline() {
  const cols = props.columns;
  localPipelines.value.push({
    from: cols[0]?.name || '',
    to: cols[1]?.name || '',
    prompt: '',
  });
  emit('update', localPipelines.value);
}

function removePipeline(index: number) {
  localPipelines.value.splice(index, 1);
  emit('update', localPipelines.value);
}

function updatePipeline(index: number, field: keyof PipelineConfig, value: string) {
  localPipelines.value[index] = { ...localPipelines.value[index], [field]: value };
  emit('update', localPipelines.value);
}
</script>

<template>
  <div class="pipeline-editor">
    <h4>Pipelines</h4>
    <div v-for="(p, i) in localPipelines" :key="i" class="pipeline-row">
      <div class="transition-row">
        <select :value="p.from" @change="updatePipeline(i, 'from', ($event.target as HTMLSelectElement).value)">
          <option v-for="col in columns" :key="col.name" :value="col.name">{{ col.name }}</option>
        </select>
        <span class="arrow">-></span>
        <select :value="p.to" @change="updatePipeline(i, 'to', ($event.target as HTMLSelectElement).value)">
          <option v-for="col in columns" :key="col.name" :value="col.name">{{ col.name }}</option>
        </select>
        <button @click="removePipeline(i)" class="remove-btn">x</button>
      </div>
      <textarea
        :value="p.prompt"
        @input="updatePipeline(i, 'prompt', ($event.target as HTMLTextAreaElement).value)"
        placeholder="Prompt template... Use {{session.name}}, {{project.path}}, etc."
        rows="3"
      />
    </div>
    <button class="add-pipeline-btn" @click="addPipeline">+ Add Pipeline</button>
    <div class="variables-help">
      <span class="label">Variables:</span>
      <code v-for="v in ['session.name','session.id','project.path','project.name','card.description','column.from','column.to']" :key="v">
        {{'{{' + v + '}}'}}
      </code>
    </div>
  </div>
</template>

<style scoped>
.pipeline-editor { display: flex; flex-direction: column; gap: 12px; }
h4 { font-size: 14px; color: var(--text-primary); }
.pipeline-row { display: flex; flex-direction: column; gap: 6px; padding: 10px; background: var(--bg-primary); border-radius: 6px; border: 1px solid var(--bg-tertiary); }
.transition-row { display: flex; align-items: center; gap: 8px; }
.arrow { color: var(--text-muted); font-size: 12px; }
select { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 4px; padding: 4px 8px; font-size: 12px; color: var(--text-primary); }
textarea { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 4px; padding: 8px; font-size: 12px; font-family: monospace; resize: vertical; color: var(--text-primary); }
textarea:focus { outline: none; border-color: var(--accent); }
.remove-btn { color: var(--error); font-size: 14px; padding: 4px 8px; margin-left: auto; }
.add-pipeline-btn { color: var(--accent); font-size: 13px; padding: 6px; text-align: left; }
.add-pipeline-btn:hover { background: var(--bg-tertiary); border-radius: 4px; }
.variables-help { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; font-size: 11px; color: var(--text-muted); }
.variables-help code { background: var(--bg-tertiary); padding: 1px 6px; border-radius: 3px; font-size: 10px; }
.label { margin-right: 4px; }
</style>
```

- [ ] **Step 3: Write ProjectSettings container**

```vue
<!-- src/components/ProjectSettings.vue -->
<script setup lang="ts">
import { computed } from 'vue';
import { useProjectsStore } from '../stores/projects';
import { usePipelinesStore } from '../stores/pipelines';
import { useCardsStore } from '../stores/cards';
import type { ColumnConfig, PipelineConfig } from '../types';
import ColumnEditor from './ColumnEditor.vue';
import PipelineEditor from './PipelineEditor.vue';

const emit = defineEmits<{ close: [] }>();
const projectsStore = useProjectsStore();
const pipelinesStore = usePipelinesStore();

const project = computed(() => projectsStore.activeProject);
const config = computed(() => {
  if (!project.value) return null;
  return pipelinesStore.getConfig(project.value.path) || null;
});

const cardsStore = useCardsStore();

async function onColumnsUpdate(columns: ColumnConfig[]) {
  if (!project.value || !config.value) return;
  await pipelinesStore.saveConfig(project.value.path, { ...config.value, columns });
}

async function onColumnRemoved(removedName: string) {
  if (!project.value || !config.value) return;
  // Migrate cards from removed column to the first available column
  const targetColumn = config.value.columns[0]?.name;
  if (targetColumn) {
    const affectedCards = cardsStore.cards.filter(c => c.columnName === removedName);
    for (const card of affectedCards) {
      await cardsStore.moveCard(card.id, targetColumn, 0);
    }
  }
  // Remove pipelines referencing the deleted column
  const pipelines = config.value.pipelines.filter(
    p => p.from !== removedName && p.to !== removedName
  );
  await pipelinesStore.saveConfig(project.value.path, { ...config.value, pipelines });
}

async function onColumnRenamed(oldName: string, newName: string) {
  if (!project.value || !config.value) return;
  // Update pipeline references
  const pipelines = config.value.pipelines.map(p => ({
    ...p,
    from: p.from === oldName ? newName : p.from,
    to: p.to === oldName ? newName : p.to,
  }));
  await pipelinesStore.saveConfig(project.value.path, { ...config.value, pipelines });
  // Update cards in that column
  const affectedCards = cardsStore.cards.filter(c => c.columnName === oldName);
  for (const card of affectedCards) {
    await cardsStore.moveCard(card.id, newName, card.columnOrder);
  }
}

async function onPipelinesUpdate(pipelines: PipelineConfig[]) {
  if (!project.value || !config.value) return;
  await pipelinesStore.saveConfig(project.value.path, { ...config.value, pipelines });
}
</script>

<template>
  <div class="settings-overlay" @click.self="emit('close')">
    <div class="settings-panel">
      <div class="settings-header">
        <h3>Project Settings</h3>
        <button class="close-btn" @click="emit('close')">x</button>
      </div>
      <div v-if="project" class="settings-body">
        <div class="setting-group">
          <label class="label">Project Path</label>
          <code class="path">{{ project.path }}</code>
        </div>
        <ColumnEditor
          v-if="config"
          :columns="config.columns"
          @update="onColumnsUpdate"
          @column-removed="onColumnRemoved"
          @column-renamed="onColumnRenamed"
        />
        <PipelineEditor
          v-if="config"
          :pipelines="config.pipelines"
          :columns="config.columns"
          @update="onPipelinesUpdate"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; }
.settings-panel { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; width: 560px; max-height: 80vh; display: flex; flex-direction: column; }
.settings-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--border); }
.settings-header h3 { font-size: 16px; }
.close-btn { font-size: 16px; color: var(--text-muted); padding: 2px 6px; border-radius: 4px; }
.close-btn:hover { background: var(--bg-tertiary); }
.settings-body { padding: 18px; overflow-y: auto; display: flex; flex-direction: column; gap: 20px; }
.setting-group { display: flex; flex-direction: column; gap: 4px; }
.label { font-size: 12px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
.path { font-size: 12px; color: var(--text-secondary); background: var(--bg-primary); padding: 6px 8px; border-radius: 4px; }
</style>
```

- [ ] **Step 4: Add settings button to TabBar**

In `src/components/TabBar.vue`, add a settings icon button next to the active tab that opens `ProjectSettings`. This requires adding a `showSettings` ref and rendering `<ProjectSettings>` conditionally.

Add to the `<template>` inside `.tab-bar`, after the tabs loop:

```html
<button
  v-if="projectsStore.activeProject"
  class="tab settings-tab"
  @click="showSettings = true"
  title="Project settings"
>
  Settings
</button>
```

Add to `<script setup>`:
```typescript
import ProjectSettings from './ProjectSettings.vue';
const showSettings = ref(false);
```

Add after `</div>` (closing tab-bar):
```html
<ProjectSettings v-if="showSettings" @close="showSettings = false" />
```

- [ ] **Step 5: Commit**

```bash
git add src/components/ProjectSettings.vue src/components/ColumnEditor.vue src/components/PipelineEditor.vue src/components/TabBar.vue
git commit -m "feat: add project settings UI with column and pipeline editors"
```

---

### Task 25: GlobalSettings component

**Files:**
- Create: `src/components/GlobalSettings.vue`

- [ ] **Step 1: Write the global settings component**

```vue
<!-- src/components/GlobalSettings.vue -->
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useSettingsStore } from '../stores/settings';
import { useSessionsStore } from '../stores/sessions';

const emit = defineEmits<{ close: [] }>();
const settingsStore = useSettingsStore();
const sessionsStore = useSessionsStore();

const claudePath = ref(settingsStore.settings.claudeBinaryPath);
const binaryStatus = ref<'checking' | 'ok' | 'error'>('checking');

onMounted(async () => {
  const ok = await sessionsStore.verifyClaudeBinary();
  binaryStatus.value = ok ? 'ok' : 'error';
});

async function savePath() {
  await settingsStore.updateClaudePath(claudePath.value);
  const ok = await sessionsStore.verifyClaudeBinary();
  binaryStatus.value = ok ? 'ok' : 'error';
}
</script>

<template>
  <div class="dialog-overlay" @click.self="emit('close')">
    <div class="dialog">
      <div class="dialog-header">
        <h3>Global Settings</h3>
        <button class="close-btn" @click="emit('close')">x</button>
      </div>
      <div class="dialog-body">
        <label>
          Claude Binary Path
          <div class="input-row">
            <input v-model="claudePath" placeholder="claude" @blur="savePath" @keydown.enter="savePath" />
            <span
              class="status-badge"
              :class="binaryStatus"
            >
              {{ binaryStatus === 'ok' ? 'Found' : binaryStatus === 'error' ? 'Not found' : '...' }}
            </span>
          </div>
        </label>
        <p v-if="binaryStatus === 'error'" class="error-msg">
          Claude Code not found at this path. Install Claude Code or provide the full path to the binary.
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; }
.dialog { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; width: 420px; }
.dialog-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--border); }
.dialog-header h3 { font-size: 16px; }
.close-btn { font-size: 16px; color: var(--text-muted); padding: 2px 6px; border-radius: 4px; }
.close-btn:hover { background: var(--bg-tertiary); }
.dialog-body { padding: 18px; display: flex; flex-direction: column; gap: 12px; }
label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-secondary); }
.input-row { display: flex; gap: 8px; align-items: center; }
input { flex: 1; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 4px; padding: 8px; font-size: 13px; }
input:focus { outline: none; border-color: var(--accent); }
.status-badge { font-size: 11px; padding: 2px 8px; border-radius: 3px; }
.status-badge.ok { background: rgba(34,197,94,0.2); color: var(--success); }
.status-badge.error { background: rgba(239,68,68,0.2); color: var(--error); }
.status-badge.checking { color: var(--text-muted); }
.error-msg { font-size: 12px; color: var(--error); }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/GlobalSettings.vue
git commit -m "feat: add GlobalSettings component with claude binary path config"
```

---

### Task 26: Resizable split panel divider

**Files:**
- Modify: `src/App.vue`

- [ ] **Step 1: Add a proper draggable divider between board and chat panel**

Replace the simple CSS `resize` with a draggable divider element in `App.vue`. Add a `<div class="divider">` between `.board-area` and `<ChatPanel>`, and use a mousedown/mousemove handler to resize the chat panel width:

In `<template>`, between board-area and ChatPanel:
```html
<div
  v-if="showChat"
  class="divider"
  @mousedown="startResize"
/>
```

In `<script setup>`, add:
```typescript
const chatWidth = ref(400);

function startResize(e: MouseEvent) {
  const startX = e.clientX;
  const startWidth = chatWidth.value;

  function onMouseMove(e: MouseEvent) {
    chatWidth.value = Math.max(320, Math.min(600, startWidth - (e.clientX - startX)));
  }
  function onMouseUp() {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}
```

In `<ChatPanel>`, bind `:style="{ width: chatWidth + 'px' }"` and remove the CSS `resize: horizontal` and fixed `width` from ChatPanel.vue's `.chat-panel` styles.

- [ ] **Step 2: Add divider styles**

```css
.divider {
  width: 4px;
  cursor: col-resize;
  background: var(--border);
  transition: background 0.15s;
}
.divider:hover {
  background: var(--accent);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/App.vue src/components/ChatPanel.vue
git commit -m "feat: add draggable split panel divider between board and chat"
```

---

### Task 27: Final build and verification

- [ ] **Step 1: Run production build**

```bash
pnpm tauri build
```

Expected: Build succeeds, produces a distributable app in `src-tauri/target/release/bundle/`.

- [ ] **Step 2: Test the built app**

Run the produced binary and repeat the smoke test from Task 23.

- [ ] **Step 3: Commit any remaining fixes**

```bash
git add -A
git commit -m "fix: final adjustments from production build testing"
```

---

## Summary

| Chunk | Tasks | What it delivers |
|-------|-------|-----------------|
| 1: Foundation | 1-7 | Project scaffold, types, services (DB, config, Claude process, templates, parser) |
| 2: State | 8-12 | Pinia stores (settings, projects, cards, sessions, pipelines) |
| 3: UI | 13-21 | All Vue components (app shell, tabs, board, columns, cards, chat, dialogs) |
| 4: Integration | 22-27 | Tauri permissions, e2e testing, settings UI (project + global), resizable divider, production build |
