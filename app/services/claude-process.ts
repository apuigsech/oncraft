import { Command } from '@tauri-apps/plugin-shell';
import { invoke } from '@tauri-apps/api/core';
import { writeFile, mkdir, remove } from '@tauri-apps/plugin-fs';
import { tempDir, join as pathJoin } from '@tauri-apps/api/path';
import { reactive } from 'vue';
import type { ChatPart, SidecarMessage, SessionConfig } from '~/types';
import type { ImageAttachment } from '~/types';
import { process as registryProcess } from './chat-part-registry';
import { createUtilRequestTracker } from './util-sidecar-protocol';
import { loadFlow } from '~/services/flow-loader';
import * as db from '~/services/database';
import { perfEnd, perfStart } from '~/services/perf';

interface SidecarProcess {
  write: (data: string) => Promise<void>;
  kill: () => void;
}

// Flow-injected configuration passed from the frontend to the sidecar.
// Replaces the old columnPrompt string parameter.
export interface FlowPayload {
  systemPromptAppend?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  agents?: Record<string, {
    description: string;
    prompt: string;
    model?: string;
    tools?: string[];
    disallowedTools?: string[];
    skills?: string[];
    maxTurns?: number;
  }>;
  mcpServers?: Record<string, {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
}

// ─── Start command builder (shared by spawnSession and sendStart) ───
function buildStartCmd(
  cardId: string,
  prompt: string,
  projectPath: string,
  sessionId?: string,
  config?: SessionConfig,
  imagePaths?: { path: string; mediaType: string }[],
  flowPayload?: FlowPayload,
  forkSession?: boolean,
): string {
  return JSON.stringify({
    cmd: 'start',
    cardId,
    prompt,
    projectPath,
    ...(sessionId ? { sessionId } : {}),
    ...(config?.model          ? { model:          config.model          } : {}),
    ...(config?.effort         ? { effort:         config.effort         } : {}),
    ...(config?.permissionMode ? { permissionMode: config.permissionMode } : {}),
    ...(config?.worktreeName   ? { worktreeName:   config.worktreeName.slice(0, 64) } : {}),
    ...(imagePaths?.length     ? { imagePaths }                            : {}),
    ...(flowPayload?.systemPromptAppend                              ? { systemPromptAppend: flowPayload.systemPromptAppend } : {}),
    ...(flowPayload?.allowedTools?.length                            ? { allowedTools:       flowPayload.allowedTools       } : {}),
    ...(flowPayload?.disallowedTools?.length                         ? { disallowedTools:    flowPayload.disallowedTools    } : {}),
    ...(flowPayload?.agents && Object.keys(flowPayload.agents).length ? { agents:            flowPayload.agents             } : {}),
    ...(flowPayload?.mcpServers && Object.keys(flowPayload.mcpServers).length ? { mcpServers: flowPayload.mcpServers        } : {}),
    ...(forkSession ? { forkSession: true } : {}),
  });
}

// ─── Image temp file helpers ───
// Write image attachments to temp files and return paths.
// This avoids sending large base64 payloads over Tauri stdin IPC.
const _tempImageFiles = new Map<string, number>();
const TEMP_IMAGE_TTL_MS = 30 * 60 * 1000;

async function cleanupTempImages(force = false): Promise<void> {
  const now = Date.now();
  for (const [filePath, createdAt] of _tempImageFiles) {
    if (!force && now - createdAt < TEMP_IMAGE_TTL_MS) continue;
    try {
      await remove(filePath);
    } catch {
      // ignore best-effort cleanup
    } finally {
      _tempImageFiles.delete(filePath);
    }
  }
}

async function writeImagesToTempFiles(images: ImageAttachment[]): Promise<{ path: string; mediaType: string }[]> {
  await cleanupTempImages();
  const tmp = await tempDir();
  const imgDir = await pathJoin(tmp, 'oncraft-images');
  try { await mkdir(imgDir, { recursive: true }); } catch { /* exists */ }
  const results: { path: string; mediaType: string }[] = [];
  for (const img of images) {
    const ext = img.mediaType.split('/')[1] || 'png';
    const fileName = `${img.id}.${ext}`;
    const filePath = await pathJoin(imgDir, fileName);
    // Decode base64 to bytes
    const binaryStr = atob(img.data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    await writeFile(filePath, bytes);
    _tempImageFiles.set(filePath, Date.now());
    results.push({ path: filePath, mediaType: img.mediaType });
  }
  return results;
}

// Track running sidecar processes by cardId
const processes = new Map<string, SidecarProcess>();

type PartCallback = (part: ChatPart) => void;
type MetaCallback = (msg: SidecarMessage) => void;
const messageCallbacks = new Map<string, PartCallback>();
const metaCallbacks = new Map<string, MetaCallback>();

// Track whether a query is actively running (vs sidecar idle between queries).
// Uses Vue reactive() so that isQueryActive() triggers reactivity in computed properties.
const activeQueries = reactive(new Set<string>());


export function onMessage(cardId: string, callback: PartCallback): void {
  messageCallbacks.set(cardId, callback);
}

export function offMessage(cardId: string): void {
  messageCallbacks.delete(cardId);
}

export function onMeta(cardId: string, callback: MetaCallback): void {
  metaCallbacks.set(cardId, callback);
}

export function offMeta(cardId: string): void {
  metaCallbacks.delete(cardId);
}

function dispatchMessage(cardId: string, part: ChatPart): void {
  const cb = messageCallbacks.get(cardId);
  if (cb) cb(part);
}

function dispatchMeta(cardId: string, msg: SidecarMessage): void {
  const cb = metaCallbacks.get(cardId);
  if (cb) cb(msg);
}

export async function spawnSession(
  cardId: string,
  projectPath: string,
  prompt: string,
  sessionId?: string,
  config?: SessionConfig,
  images?: import('~/types').ImageAttachment[],
  flowPayload?: FlowPayload,
  forkSession?: boolean,
): Promise<void> {
  const spawnStart = perfStart('sidecar.spawnSession.total');
  // Kill existing process for this card if any
  if (processes.has(cardId)) {
    await killProcess(cardId);
  }

  const command = Command.sidecar('binaries/agent-bridge');
  const child = await command.spawn();

  let lineBuffer = '';

  command.stdout.on('data', (data: string) => {
    lineBuffer += data;
    const lines = lineBuffer.split('\n');
    // Keep the last incomplete line in the buffer
    lineBuffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const raw = JSON.parse(line) as Record<string, unknown>;

        // 0. Intercept session_request from MCP tools
        if (raw.type === 'session_request') {
          handleSessionRequest(cardId, raw as SessionRequest);
          continue;
        }

        const sidecarMsg = raw as SidecarMessage;

        // 1. Intercept result — extract metrics, mark query complete
        if (sidecarMsg.type === 'result') {
          dispatchMeta(cardId, sidecarMsg);
          continue;
        }

        // 2. Intercept init — extract sessionId, gitBranch, etc.
        // The sidecar emits init as { type: "system", subtype: "init", sessionId: "..." }
        if (sidecarMsg.type === 'system' && sidecarMsg.subtype === 'init') {
          dispatchMeta(cardId, { ...sidecarMsg, type: 'init' });
          continue;
        }

        // 3. Intercept streaming deltas — buffer via store
        if (sidecarMsg.type === 'assistant' && (sidecarMsg.subtype === 'streaming' || sidecarMsg.subtype === 'thinking_streaming')) {
          dispatchMeta(cardId, sidecarMsg);
          continue;
        }

        // 3b. Intercept session_state_changed — update card state directly
        if (sidecarMsg.type === 'session_state_changed') {
          dispatchMeta(cardId, sidecarMsg);
          continue;
        }

        // 3c. Intercept session_died — SDK session crashed, need to clean up query state
        if (sidecarMsg.type === 'system' && sidecarMsg.subtype === 'session_died') {
          dispatchMeta(cardId, { ...sidecarMsg, type: 'session_died' });
          continue;
        }

        // 4. Process through registry
        const part = registryProcess(sidecarMsg);

        // 5. tool_result returns null from registry but needs merge
        if (!part && sidecarMsg.type === 'tool_result') {
          dispatchMeta(cardId, sidecarMsg);
          continue;
        }

        // 6. Normal ChatPart — dispatch to store
        if (part) {
          dispatchMessage(cardId, part);
        }
      } catch {
        if (import.meta.dev) console.warn('[OnCraft] parse error:', line.substring(0, 200));
      }
    }
  });

  command.stderr.on('data', (data: string) => {
    if (import.meta.dev) console.warn('[OnCraft] sidecar stderr:', data);
  });

  command.on('close', (payload) => {
    // Flush remaining buffer
    if (lineBuffer.trim()) {
      try {
        const raw: SidecarMessage = JSON.parse(lineBuffer);

        if (raw.type === 'result') {
          dispatchMeta(cardId, raw);
        } else if (raw.type === 'init') {
          dispatchMeta(cardId, raw);
        } else if (raw.type === 'assistant' && (raw.subtype === 'streaming' || raw.subtype === 'thinking_streaming')) {
          dispatchMeta(cardId, raw);
        } else if (raw.type === 'session_state_changed') {
          dispatchMeta(cardId, raw);
        } else if (raw.type === 'system' && raw.subtype === 'session_died') {
          dispatchMeta(cardId, { ...raw, type: 'session_died' });
        } else {
          const part = registryProcess(raw);
          if (!part && raw.type === 'tool_result') {
            dispatchMeta(cardId, raw);
          } else if (part) {
            dispatchMessage(cardId, part);
          }
        }
      } catch {
        if (import.meta.dev) console.warn('[OnCraft] parse error on close flush:', lineBuffer.substring(0, 200));
      }
      lineBuffer = '';
    }
    // If the query was still active when the sidecar closed, dispatch session_died
    // so the sessions store can clean up card state (mark idle/error).
    if (activeQueries.has(cardId)) {
      dispatchMeta(cardId, { type: 'session_died', content: `Sidecar exited with code ${payload.code}` } as SidecarMessage);
    }
    processes.delete(cardId);
    messageCallbacks.delete(cardId);
    metaCallbacks.delete(cardId);
    activeQueries.delete(cardId);
    if (import.meta.dev) console.log('[OnCraft] sidecar closed, code:', payload.code);
  });

  command.on('error', (err: string) => {
    if (import.meta.dev) console.error('[OnCraft] sidecar error:', err);
    const errorMsg: SidecarMessage = { type: 'error', message: `Sidecar error: ${err}` };
    const part = registryProcess(errorMsg);
    if (part) dispatchMessage(cardId, part);
    // Dispatch session_died so the sessions store can clean up card state
    if (activeQueries.has(cardId)) {
      dispatchMeta(cardId, { type: 'session_died', content: `Sidecar error: ${err}` } as SidecarMessage);
    }
    processes.delete(cardId);
    messageCallbacks.delete(cardId);
    metaCallbacks.delete(cardId);
    activeQueries.delete(cardId);
  });

  const proc: SidecarProcess = {
    write: async (data: string) => {
      await child.write(data + '\n');
    },
    kill: () => {
      child.kill();
    },
  };

  processes.set(cardId, proc);

  // Mark query as active and send the start command
  activeQueries.add(cardId);

  // Write images to temp files to avoid large base64 payloads over stdin IPC
  let imagePaths: { path: string; mediaType: string }[] | undefined;
  if (images?.length) {
    imagePaths = await writeImagesToTempFiles(images);
    if (import.meta.dev) console.log(`[OnCraft] wrote ${imagePaths.length} images to temp files`);
  }

  const startCmd = buildStartCmd(cardId, prompt, projectPath, sessionId, config, imagePaths, flowPayload, forkSession);
  if (import.meta.dev) {
    console.log(`[OnCraft] sending start cmd, length=${startCmd.length}, hasImages=${!!imagePaths?.length}, hasFlowPrompt=${!!flowPayload?.systemPromptAppend}`);
  }
  await proc.write(startCmd);
  perfEnd('sidecar.spawnSession.total', spawnStart, { cardId, hasImages: !!images?.length });
}

export async function sendStart(
  cardId: string,
  projectPath: string,
  prompt: string,
  sessionId?: string,
  config?: SessionConfig,
  images?: import('~/types').ImageAttachment[],
  flowPayload?: FlowPayload,
  forkSession?: boolean,
): Promise<void> {
  const start = perfStart('sidecar.sendStart.total');
  const proc = processes.get(cardId);
  if (!proc) throw new Error('No sidecar process for this card');
  activeQueries.add(cardId);

  // Write images to temp files to avoid large base64 payloads over stdin IPC
  let imagePaths: { path: string; mediaType: string }[] | undefined;
  if (images?.length) {
    imagePaths = await writeImagesToTempFiles(images);
  }

  const startCmd = buildStartCmd(cardId, prompt, projectPath, sessionId, config, imagePaths, flowPayload, forkSession);
  await proc.write(startCmd);
  perfEnd('sidecar.sendStart.total', start, { cardId, hasImages: !!images?.length });
}

export async function sendReply(cardId: string, content: 'allow' | 'deny', updatedInput?: Record<string, unknown>): Promise<void> {
  const start = perfStart('sidecar.sendReply');
  const proc = processes.get(cardId);
  if (!proc) return;
  await proc.write(JSON.stringify({ cmd: 'reply', content, ...(updatedInput ? { updatedInput } : {}) }));
  perfEnd('sidecar.sendReply', start, { cardId, content });
}

export async function interrupt(cardId: string): Promise<void> {
  const proc = processes.get(cardId);
  if (!proc) return;
  await proc.write(JSON.stringify({ cmd: 'interrupt' }));
}

export async function killProcess(cardId: string): Promise<void> {
  const proc = processes.get(cardId);
  if (!proc) return;
  try {
    await proc.write(JSON.stringify({ cmd: 'stop' }));
  } catch {
    // Process may already be dead
  }
  proc.kill();
  processes.delete(cardId);
  messageCallbacks.delete(cardId);
  metaCallbacks.delete(cardId);
  activeQueries.delete(cardId);
}

export function listActiveProcessCardIds(): string[] {
  return Array.from(processes.keys());
}

export async function killAllProcesses(): Promise<void> {
  const ids = Array.from(processes.keys());
  for (const id of ids) {
    try {
      await killProcess(id);
    } catch {
      // continue best-effort cleanup
    }
  }
}

export function isProcessActive(cardId: string): boolean {
  return processes.has(cardId);
}

export function isQueryActive(cardId: string): boolean {
  return activeQueries.has(cardId);
}

export function markQueryComplete(cardId: string): void {
  activeQueries.delete(cardId);
}

export interface SessionInfo {
  sessionId: string;
  summary: string;
  lastModified: number;
  createdAt: number;
  gitBranch: string;
}

export interface SlashCommand {
  name: string;
  desc: string;
  source: string;
}

// ---------------------------------------------------------------------------
// MCP session_request handler — bridges sidecar MCP tools to Pinia stores
// ---------------------------------------------------------------------------

interface SessionRequest {
  type: 'session_request';
  requestId: string;
  action: string;
  [key: string]: unknown;
}

// Sync only the fields changed by this MCP request to the reactive store object.
// We deliberately avoid syncing ALL fields from the DB card because hot-path
// operations (updateCardState, updateCardMetrics) use debounced writes — syncing
// stale DB values would clobber in-flight updates not yet flushed to SQLite.
// columnName/columnOrder are excluded because moveCardToColumn updates the store directly.
function syncCardToStore(cardId: string, dbCard: import('~/types').Card, changedFields: Set<string>): void {
  const cardsStore = useCardsStore();
  const live = cardsStore.cards.find(c => c.id === cardId);
  if (!live) return;
  for (const field of changedFields) {
    (live as any)[field] = (dbCard as any)[field];
  }
  live.lastActivityAt = dbCard.lastActivityAt;
}

async function handleSessionRequest(cardId: string, req: SessionRequest): Promise<void> {
  const proc = processes.get(cardId);
  if (!proc) return;

  let responseData: Record<string, unknown> = {};

  try {
    if (req.action === 'get_current_card') {
      const card = await db.getCardById(cardId);
      if (card) {
        responseData = { card: { ...card } };
      } else {
        responseData = { card: null, error: `Card ${cardId} not found in database` };
      }

    } else if (req.action === 'update_current_card') {
      const card = await db.getCardById(cardId);
      if (card) {
        const changedFields = new Set<string>();

        // Column move requires the active project (for flow validation + trigger prompts)
        if (req.columnName !== undefined && req.columnName !== card.columnName) {
          const cardsStore = useCardsStore();
          const liveCard = cardsStore.cards.find(c => c.id === cardId);
          if (!liveCard) {
            responseData = { success: false, error: 'Column move requires the card\'s project to be active in the UI' };
            await proc.write(JSON.stringify({ cmd: 'session_response', requestId: req.requestId, data: responseData }));
            return;
          }
          const result = await cardsStore.moveCardToColumn(cardId, req.columnName as string);
          if (!result.success) {
            responseData = { success: false, error: 'Missing required files', missingFiles: result.missingFiles };
            await proc.write(JSON.stringify({ cmd: 'session_response', requestId: req.requestId, data: responseData }));
            return;
          }
          // Re-read card after move (moveCardToColumn persists to DB)
          const updated = await db.getCardById(cardId);
          if (updated) Object.assign(card, updated);
        }

        // LinkedFiles: merge semantics (spread + filter empty strings)
        if (req.linkedFiles !== undefined) {
          const incoming = req.linkedFiles as Record<string, string>;
          const merged = { ...(card.linkedFiles || {}), ...incoming };
          const cleaned = Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== ''));
          card.linkedFiles = Object.keys(cleaned).length > 0 ? cleaned : undefined;
          changedFields.add('linkedFiles');
        }

        // LinkedIssues: replace
        if (req.linkedIssues !== undefined) {
          const issues = req.linkedIssues as import('~/types').CardLinkedIssue[];
          card.linkedIssues = issues.length > 0 ? issues : undefined;
          changedFields.add('linkedIssues');
        }

        // Simple scalar fields
        const simpleFields = ['name', 'description', 'state', 'tags', 'archived'] as const;
        for (const field of simpleFields) {
          if (req[field] !== undefined) {
            (card as any)[field] = req[field];
            changedFields.add(field);
          }
        }

        // Persist to DB
        card.lastActivityAt = new Date().toISOString();
        await db.updateCard(card);

        // Sync only changed fields to reactive store (avoids clobbering debounced writes)
        syncCardToStore(cardId, card, changedFields);

        responseData = { success: true, card: { ...card } };
      } else {
        responseData = { success: false, error: `Card ${cardId} not found in database` };
      }

    } else if (req.action === 'get_project') {
      const card = await db.getCardById(cardId);
      const project = card ? await db.getProjectById(card.projectId) : null;
      let columns: Array<{ name: string; slug: string; color: string; hasPrompt: boolean }> = [];

      if (project) {
        try {
          const flowResult = await loadFlow(project.path);
          columns = flowResult.flow.stateOrder
            .map(slug => flowResult.flow.states.find(s => s.slug === slug))
            .filter((s): s is NonNullable<typeof s> => !!s)
            .map(s => ({
              name: s.name,
              slug: s.slug,
              color: s.color,
              hasPrompt: !!s.prompt,
            }));
        } catch {
          // Fallback to currently loaded flow for resiliency.
          const flowStore = useFlowStore();
          columns = flowStore.stateOrder.map(slug => {
            const s = flowStore.getFlowState(slug);
            return s ? {
              name: s.name,
              slug: s.slug,
              color: s.color,
              hasPrompt: !!s.prompt,
            } : null;
          }).filter((c): c is { name: string; slug: string; color: string; hasPrompt: boolean } => !!c);
        }
      }
      responseData = {
        project: project ? { id: project.id, name: project.name, path: project.path } : null,
        columns,
      };

    } else {
      responseData = { error: `Unknown action: ${req.action}` };
    }
  } catch (err) {
    responseData = { error: String(err) };
  }

  await proc.write(JSON.stringify({
    cmd: 'session_response',
    requestId: req.requestId,
    data: responseData,
  }));
}

// ---------------------------------------------------------------------------
// DA-1: listCommands and deleteSession are now native Rust commands.
// The shared utility sidecar is only needed for SDK-dependent operations
// (listSessions, loadHistory) that require the Claude Agent SDK.
// ---------------------------------------------------------------------------

interface PendingRequest {
  timer: ReturnType<typeof setTimeout>;
  startedAt: number;
  responseType: string;
}

let _utilSidecar: {
  write: (data: string) => Promise<void>;
  kill: () => void;
} | null = null;
let _utilSpawning: Promise<void> | null = null;
let _utilLineBuffer = '';
const _utilTracker = createUtilRequestTracker();
const _utilPendingMeta = new Map<string, PendingRequest>();

function _handleUtilLine(line: string): void {
  if (_utilTracker.resolveFromLine(line)) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const requestId = parsed.requestId as string | undefined;
      if (!requestId) return;
      const meta = _utilPendingMeta.get(requestId);
      if (!meta) return;
      clearTimeout(meta.timer);
      _utilPendingMeta.delete(requestId);
      perfEnd(`sidecar.util.${meta.responseType}`, meta.startedAt);
    } catch {
      // ignore parse errors on already-resolved lines
    }
  }
}

async function _ensureUtilSidecar(): Promise<{ write: (data: string) => Promise<void> }> {
  if (_utilSidecar) return _utilSidecar;

  // Prevent multiple concurrent spawns
  if (_utilSpawning) {
    await _utilSpawning;
    if (_utilSidecar) return _utilSidecar;
  }

  _utilSpawning = (async () => {
    const command = Command.sidecar('binaries/agent-bridge');
    const child = await command.spawn();

    command.stdout.on('data', (data: string) => {
      _utilLineBuffer += data;
      const lines = _utilLineBuffer.split('\n');
      _utilLineBuffer = lines.pop() || '';
      for (const line of lines) _handleUtilLine(line);
    });

    command.on('close', () => {
      _utilSidecar = null;
      // Reject any pending requests
      for (const [requestId, pending] of _utilPendingMeta) {
        clearTimeout(pending.timer);
        perfEnd(`sidecar.util.${pending.responseType}`, pending.startedAt, { closed: true });
        _utilPendingMeta.delete(requestId);
      }
      _utilTracker.rejectAll('sidecar closed');
      _utilLineBuffer = '';
    });

    command.on('error', () => {
      _utilSidecar = null;
    });

    _utilSidecar = {
      write: async (data: string) => { await child.write(data + '\n'); },
      kill: () => { child.kill(); },
    };
  })();

  await _utilSpawning;
  _utilSpawning = null;
  return _utilSidecar!;
}

// Send a command to the shared utility sidecar and wait for a response of the given type
function _utilRequest(
  cmd: Record<string, unknown>,
  responseType: string,
  timeoutMs = 10000,
): Promise<Record<string, unknown>> {
  const requestId = crypto.randomUUID();
  return new Promise(async (resolve) => {
    const reqStart = perfStart(`sidecar.util.${responseType}`);
    try {
      const sidecar = await _ensureUtilSidecar();
      const timer = setTimeout(() => {
        _utilPendingMeta.delete(requestId);
        perfEnd(`sidecar.util.${responseType}`, reqStart, { timeout: true });
        resolve({ type: responseType, requestId, error: 'timeout' });
      }, timeoutMs);
      _utilPendingMeta.set(requestId, { timer, startedAt: reqStart, responseType });
      _utilTracker.register(requestId, responseType, resolve);
      await sidecar.write(JSON.stringify({ ...cmd, requestId }));
    } catch {
      perfEnd(`sidecar.util.${responseType}`, reqStart, { spawnFailed: true });
      resolve({ type: responseType, requestId, error: 'spawn failed' });
    }
  });
}

// Preload the utility sidecar in background so SDK-dependent
// operations (listSessions, loadHistory) don't suffer cold-start latency.
export function preloadUtilSidecar(): void {
  _ensureUtilSidecar();
}

export function shutdownUtilSidecar(): void {
  try {
    _utilSidecar?.kill();
  } catch {
    // best effort
  } finally {
    _utilSidecar = null;
    _utilLineBuffer = '';
    for (const [requestId, pending] of _utilPendingMeta) {
      clearTimeout(pending.timer);
      perfEnd(`sidecar.util.${pending.responseType}`, pending.startedAt, { shutdown: true });
      _utilPendingMeta.delete(requestId);
    }
    _utilTracker.rejectAll('shutdown');
    void cleanupTempImages(true);
  }
}

// DA-1: listCommands — native Rust command, no sidecar needed
export async function listCommandsNative(projectPath?: string): Promise<SlashCommand[]> {
  try {
    return await invoke<SlashCommand[]>('list_commands', {
      projectPath: projectPath || null,
    });
  } catch {
    return [];
  }
}

// Git branch ahead/behind counts relative to the principal branch.
export interface BranchStatus {
  ahead: number;
  behind: number;
  branch: string;
  base: string;
  error?: string;
}

export async function gitBranchStatus(
  repoPath: string,
  branch?: string,
  base?: string,
): Promise<BranchStatus | null> {
  try {
    return await invoke<BranchStatus>('git_branch_status', {
      repoPath,
      branch: branch ?? null,
      base: base ?? null,
    });
  } catch {
    return null;
  }
}

// DA-1: deleteSession — native Rust command, no sidecar needed
export async function deleteSessionNative(sessionId: string): Promise<boolean> {
  try {
    return await invoke<boolean>('delete_session', { sessionId });
  } catch {
    return false;
  }
}

// listSessions — still requires the Claude Agent SDK via sidecar
export async function listSessionsViaSidecar(projectPath: string): Promise<SessionInfo[]> {
  const result = await _utilRequest(
    { cmd: 'listSessions', projectPath },
    'sessions',
  );
  return (result.sessions as SessionInfo[]) || [];
}

// loadHistory — still requires the Claude Agent SDK via sidecar
export async function loadHistoryViaSidecar(sessionId: string): Promise<ChatPart[]> {
  const result = await _utilRequest(
    { cmd: 'loadHistory', sessionId },
    'history',
  );
  const rawMessages = (result.messages as Record<string, unknown>[]) || [];

  // First pass: collect tool_use_ids that have a corresponding tool_result
  const answeredToolIds = new Set<string>();
  for (const m of rawMessages) {
    if (m.type === 'tool_result' && m.toolUseId) {
      answeredToolIds.add(m.toolUseId as string);
    }
  }

  // Second pass: process through registry, merge tool_results, mark resolved
  const parts: ChatPart[] = [];
  for (const m of rawMessages) {
    const msg = m as SidecarMessage;

    // tool_result: merge into matching tool_use or tool_confirmation part
    if (msg.type === 'tool_result' && msg.toolUseId) {
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        if (p && p.data.toolUseId === msg.toolUseId && (p.kind === 'tool_use' || p.kind.startsWith('tool_confirmation:'))) {
          const resultContent = (msg.content || (msg as any).toolResult || '') as string;
          p.data.toolResult = resultContent;
          // For AskUserQuestion: extract the answer from the tool_result content
          if (p.kind === 'tool_confirmation:AskUserQuestion' && resultContent) {
            // The SDK returns something like "User has answered: X" — extract the answer
            // Try to parse as JSON first (in case it's structured), otherwise use raw text
            try {
              const parsed = JSON.parse(resultContent);
              if (parsed.answers) {
                const firstAnswer = Object.values(parsed.answers)[0];
                if (firstAnswer) p.data.answer = firstAnswer;
              }
            } catch {
              // Not JSON — extract the answer value from SDK format:
              // e.g. "Question text"="Answer". You can now continue...
              const match = resultContent.match(/=\s*"([^"]+)"/);
              if (match?.[1]) {
                p.data.answer = match[1];
              } else {
                // Fallback: strip SDK prefix and suffix
                const cleaned = resultContent
                  .replace(/^User has answered your questions?:\s*/i, '')
                  .replace(/\.\s*You can now continue.*$/i, '')
                  .trim();
                if (cleaned) p.data.answer = cleaned;
              }
            }
          }
          break;
        }
      }
      continue;
    }

    // Rewrite AskUserQuestion tool_use as tool_confirmation for history rendering.
    // In live mode, canUseTool() emits tool_confirmation directly (never persisted to JSONL).
    // In history, the SDK only stores tool_use. Rewrite so the registry resolves to
    // tool_confirmation:AskUserQuestion → UserQuestionBar component.
    if (msg.type === 'tool_use' && (msg as any).toolName === 'AskUserQuestion') {
      (msg as any).type = 'tool_confirmation';
    }

    const part = registryProcess(msg);
    if (!part) continue;

    // Mark action-bar parts as resolved if they have a tool_result in history
    // (meaning the user already responded in a previous session)
    if (part.placement === 'action-bar') {
      const toolUseId = part.data.toolUseId as string | undefined;
      if (toolUseId && answeredToolIds.has(toolUseId)) {
        part.resolved = true;
      }
    }

    // tool_confirmation parts from history: mark resolved based on context
    if (msg.type === 'tool_confirmation') {
      if ((msg as any).toolName === 'AskUserQuestion') {
        // AskUserQuestion: only resolved if there's a matching tool_result
        const toolUseId = part.data.toolUseId as string | undefined;
        if (!part.resolved) {
          part.resolved = !!(toolUseId && answeredToolIds.has(toolUseId));
        }
        // Keep placement as 'action-bar' — useChatParts includes resolved action-bar
        // parts in inlineParts, and useUIMessages renders them via chat-part type
      } else {
        // Normal tools: always resolved in history (session progressed past them)
        part.resolved = true;
      }
    }

    parts.push(part);
  }

  return parts;
}
