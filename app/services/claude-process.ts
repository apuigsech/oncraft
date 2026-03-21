import { Command } from '@tauri-apps/plugin-shell';
import { invoke } from '@tauri-apps/api/core';
import { writeFile, mkdir } from '@tauri-apps/plugin-fs';
import { tempDir, join as pathJoin } from '@tauri-apps/api/path';
import type { ChatPart, SidecarMessage, SessionConfig } from '~/types';
import type { ImageAttachment } from '~/types';
import { process as registryProcess } from './chat-part-registry';
import * as db from '~/services/database';

interface SidecarProcess {
  write: (data: string) => Promise<void>;
  kill: () => void;
}

// ─── Image temp file helpers ───
// Write image attachments to temp files and return paths.
// This avoids sending large base64 payloads over Tauri stdin IPC.
async function writeImagesToTempFiles(images: ImageAttachment[]): Promise<{ path: string; mediaType: string }[]> {
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

// Track whether a query is actively running (vs sidecar idle between queries)
const activeQueries = new Set<string>();

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
  columnPrompt?: string,
  forkSession?: boolean,
): Promise<void> {
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
        if (sidecarMsg.type === 'assistant' && sidecarMsg.subtype === 'streaming') {
          dispatchMeta(cardId, sidecarMsg);
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
        } else if (raw.type === 'assistant' && raw.subtype === 'streaming') {
          dispatchMeta(cardId, raw);
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
    processes.delete(cardId);
    messageCallbacks.delete(cardId);
    metaCallbacks.delete(cardId);
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

  const startCmd = JSON.stringify({
    cmd: 'start',
    cardId,
    prompt,
    projectPath,
    ...(sessionId ? { sessionId } : {}),
    ...(config?.model ? { model: config.model } : {}),
    ...(config?.effort ? { effort: config.effort } : {}),
    ...(config?.permissionMode ? { permissionMode: config.permissionMode } : {}),
    ...(config?.worktreeName ? { worktreeName: config.worktreeName } : {}),
    ...(imagePaths?.length ? { imagePaths } : {}),
    ...(columnPrompt ? { columnPrompt } : {}),
    ...(forkSession ? { forkSession: true } : {}),
  });
  if (import.meta.dev) {
    console.log(`[OnCraft] sending start cmd, length=${startCmd.length}, hasImages=${!!imagePaths?.length}`);
  }
  await proc.write(startCmd);
}

export async function sendStart(
  cardId: string,
  projectPath: string,
  prompt: string,
  sessionId?: string,
  config?: SessionConfig,
  images?: import('~/types').ImageAttachment[],
  columnPrompt?: string,
  forkSession?: boolean,
): Promise<void> {
  const proc = processes.get(cardId);
  if (!proc) throw new Error('No sidecar process for this card');
  activeQueries.add(cardId);

  // Write images to temp files to avoid large base64 payloads over stdin IPC
  let imagePaths: { path: string; mediaType: string }[] | undefined;
  if (images?.length) {
    imagePaths = await writeImagesToTempFiles(images);
  }

  const startCmd = JSON.stringify({
    cmd: 'start',
    cardId,
    prompt,
    projectPath,
    ...(sessionId ? { sessionId } : {}),
    ...(config?.model ? { model: config.model } : {}),
    ...(config?.effort ? { effort: config.effort } : {}),
    ...(config?.permissionMode ? { permissionMode: config.permissionMode } : {}),
    ...(config?.worktreeName ? { worktreeName: config.worktreeName } : {}),
    ...(imagePaths?.length ? { imagePaths } : {}),
    ...(columnPrompt ? { columnPrompt } : {}),
    ...(forkSession ? { forkSession: true } : {}),
  });
  await proc.write(startCmd);
}

export async function sendReply(cardId: string, content: 'allow' | 'deny', updatedInput?: Record<string, unknown>): Promise<void> {
  const proc = processes.get(cardId);
  if (!proc) return;
  await proc.write(JSON.stringify({ cmd: 'reply', content, ...(updatedInput ? { updatedInput } : {}) }));
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

async function handleSessionRequest(cardId: string, req: SessionRequest): Promise<void> {
  const proc = processes.get(cardId);
  if (!proc) return;

  const cardsStore = useCardsStore();
  const projectsStore = useProjectsStore();
  const pipelinesStore = usePipelinesStore();

  let responseData: Record<string, unknown> = {};

  try {
    if (req.action === 'get_current_card') {
      const card = cardsStore.cards.find(c => c.id === cardId);
      responseData = { card: card ? { ...card } : null };

    } else if (req.action === 'update_current_card') {
      const card = cardsStore.cards.find(c => c.id === cardId);
      if (card) {
        const allowed = ['name', 'description', 'columnName', 'state', 'tags', 'archived', 'linkedFiles', 'linkedIssues'] as const;
        for (const field of allowed) {
          if (req[field] !== undefined) {
            (card as any)[field] = req[field];
          }
        }
        card.lastActivityAt = new Date().toISOString();
        await db.updateCard(card);
        responseData = { success: true, card: { ...card } };
      } else {
        responseData = { success: false, error: 'Card not found' };
      }

    } else if (req.action === 'get_project') {
      const project = projectsStore.activeProject;
      const projectPath = project?.path;
      const config = projectPath ? pipelinesStore.getConfig(projectPath) : undefined;
      const columns = (config?.columns ?? []).map(c => ({
        name: c.name,
        color: c.color,
        inputs: c.inputs || [],
        outputs: c.outputs || [],
        hasPrompt: !!c.prompt,
      }));
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
  resolve: (data: Record<string, unknown>) => void;
  timer: ReturnType<typeof setTimeout>;
}

let _utilSidecar: {
  write: (data: string) => Promise<void>;
  kill: () => void;
} | null = null;
let _utilSpawning: Promise<void> | null = null;
let _utilLineBuffer = '';
// Pending one-shot requests keyed by response type (e.g. 'sessions', 'commands')
const _utilPending = new Map<string, PendingRequest>();

function _handleUtilLine(line: string): void {
  if (!line.trim()) return;
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    const type = parsed.type as string;
    const pending = _utilPending.get(type);
    if (pending) {
      clearTimeout(pending.timer);
      _utilPending.delete(type);
      pending.resolve(parsed);
    }
  } catch { /* ignore unparseable lines */ }
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
      for (const [key, pending] of _utilPending) {
        clearTimeout(pending.timer);
        pending.resolve({ type: key, error: 'sidecar closed' });
      }
      _utilPending.clear();
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
  return new Promise(async (resolve) => {
    try {
      const sidecar = await _ensureUtilSidecar();
      const timer = setTimeout(() => {
        _utilPending.delete(responseType);
        resolve({ type: responseType, error: 'timeout' });
      }, timeoutMs);
      _utilPending.set(responseType, { resolve, timer });
      await sidecar.write(JSON.stringify(cmd));
    } catch {
      resolve({ type: responseType, error: 'spawn failed' });
    }
  });
}

// Preload the utility sidecar in background so SDK-dependent
// operations (listSessions, loadHistory) don't suffer cold-start latency.
export function preloadUtilSidecar(): void {
  _ensureUtilSidecar();
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
        if (p.data.toolUseId === msg.toolUseId && (p.kind === 'tool_use' || p.kind.startsWith('tool_confirmation:'))) {
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
