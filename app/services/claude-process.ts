import { Command } from '@tauri-apps/plugin-shell';
import { invoke } from '@tauri-apps/api/core';
import type { StreamMessage, AgentProgressEvent, SessionConfig } from '~/types';
import { parseStreamLine, isProgressEvent, parseProgressEvent } from './stream-parser';

interface SidecarProcess {
  write: (data: string) => Promise<void>;
  kill: () => void;
}

// Track running sidecar processes by cardId
const processes = new Map<string, SidecarProcess>();
const messageCallbacks = new Map<string, (msg: StreamMessage) => void>();
const progressCallbacks = new Map<string, (event: AgentProgressEvent) => void>();
// Track whether a query is actively running (vs sidecar idle between queries)
const activeQueries = new Set<string>();

export function onMessage(cardId: string, callback: (msg: StreamMessage) => void): void {
  messageCallbacks.set(cardId, callback);
}

export function offMessage(cardId: string): void {
  messageCallbacks.delete(cardId);
}

export function onProgress(cardId: string, callback: (event: AgentProgressEvent) => void): void {
  progressCallbacks.set(cardId, callback);
}

export function offProgress(cardId: string): void {
  progressCallbacks.delete(cardId);
}

function dispatchMessage(cardId: string, msg: StreamMessage): void {
  const cb = messageCallbacks.get(cardId);
  if (cb) cb(msg);
}

function dispatchProgress(cardId: string, event: AgentProgressEvent): void {
  const cb = progressCallbacks.get(cardId);
  if (cb) cb(event);
}

export async function spawnSession(
  cardId: string,
  projectPath: string,
  prompt: string,
  sessionId?: string,
  config?: SessionConfig,
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
      // Check if this is an internal progress event before full parse
      try {
        const raw = JSON.parse(line) as Record<string, unknown>;
        if (isProgressEvent(raw)) {
          dispatchProgress(cardId, parseProgressEvent(raw));
          continue;
        }
      } catch { /* fall through to normal parse */ }
      const msg = parseStreamLine(line);
      if (msg) {
        dispatchMessage(cardId, msg);
      }
    }
  });

  command.stderr.on('data', (data: string) => {
    if (import.meta.dev) console.warn('[ClaudBan] sidecar stderr:', data);
  });

  command.on('close', (payload) => {
    // Flush remaining buffer
    if (lineBuffer.trim()) {
      const msg = parseStreamLine(lineBuffer);
      if (msg) dispatchMessage(cardId, msg);
      lineBuffer = '';
    }
    processes.delete(cardId);
    messageCallbacks.delete(cardId);
    activeQueries.delete(cardId);
    if (import.meta.dev) console.log('[ClaudBan] sidecar closed, code:', payload.code);
  });

  command.on('error', (err: string) => {
    if (import.meta.dev) console.error('[ClaudBan] sidecar error:', err);
    dispatchMessage(cardId, {
      type: 'system',
      content: `Sidecar error: ${err}`,
      timestamp: Date.now(),
    });
    processes.delete(cardId);
    messageCallbacks.delete(cardId);
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
  const startCmd = JSON.stringify({
    cmd: 'start',
    prompt,
    projectPath,
    ...(sessionId ? { sessionId } : {}),
    ...(config?.model ? { model: config.model } : {}),
    ...(config?.effort ? { effort: config.effort } : {}),
    ...(config?.permissionMode ? { permissionMode: config.permissionMode } : {}),
    ...(config?.worktreeName ? { worktreeName: config.worktreeName } : {}),
  });
  await proc.write(startCmd);
}

export async function sendStart(
  cardId: string,
  projectPath: string,
  prompt: string,
  sessionId?: string,
  config?: SessionConfig,
): Promise<void> {
  const proc = processes.get(cardId);
  if (!proc) throw new Error('No sidecar process for this card');
  activeQueries.add(cardId);
  const startCmd = JSON.stringify({
    cmd: 'start',
    prompt,
    projectPath,
    ...(sessionId ? { sessionId } : {}),
    ...(config?.model ? { model: config.model } : {}),
    ...(config?.effort ? { effort: config.effort } : {}),
    ...(config?.permissionMode ? { permissionMode: config.permissionMode } : {}),
    ...(config?.worktreeName ? { worktreeName: config.worktreeName } : {}),
  });
  await proc.write(startCmd);
}

export async function sendReply(cardId: string, content: 'allow' | 'deny'): Promise<void> {
  const proc = processes.get(cardId);
  if (!proc) return;
  await proc.write(JSON.stringify({ cmd: 'reply', content }));
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
export async function loadHistoryViaSidecar(sessionId: string): Promise<StreamMessage[]> {
  const result = await _utilRequest(
    { cmd: 'loadHistory', sessionId },
    'history',
  );
  const rawMessages = (result.messages as Record<string, unknown>[]) || [];
  return rawMessages.map((m) => ({
    type: m.type as StreamMessage['type'],
    content: (m.content as string) || '',
    toolName: m.toolName as string | undefined,
    toolInput: m.toolInput as Record<string, unknown> | undefined,
    toolResult: m.content as string | undefined,
    toolUseId: m.toolUseId as string | undefined,
    subtype: m.subtype as string | undefined,
    sessionId: m.sessionId as string | undefined,
    timestamp: Date.now(),
  } satisfies StreamMessage));
}
