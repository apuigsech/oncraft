import { Command } from '@tauri-apps/plugin-shell';
import type { StreamMessage, AgentProgressEvent, SessionConfig } from '../types';
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
    console.warn('[ClaudBan] sidecar stderr:', data);
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
    console.log('[ClaudBan] sidecar closed, code:', payload.code);
  });

  command.on('error', (err: string) => {
    console.error('[ClaudBan] sidecar error:', err);
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

// List all Claude sessions for a project via the sidecar
export async function listSessionsViaSidecar(projectPath: string): Promise<SessionInfo[]> {
  return new Promise((resolve) => {
    const command = Command.sidecar('binaries/agent-bridge');
    let lineBuffer = '';
    let resolved = false;

    command.stdout.on('data', (data: string) => {
      lineBuffer += data;
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'sessions') {
            resolved = true;
            resolve(parsed.sessions || []);
          }
        } catch { /* ignore */ }
      }
    });

    command.on('close', () => { if (!resolved) resolve([]); });
    command.on('error', () => { if (!resolved) resolve([]); });

    command.spawn().then(async (child) => {
      await child.write(JSON.stringify({ cmd: 'listSessions', projectPath }) + '\n');
      setTimeout(() => {
        if (!resolved) {
          if (lineBuffer.trim()) {
            try {
              const parsed = JSON.parse(lineBuffer);
              if (parsed.type === 'sessions') { resolved = true; resolve(parsed.sessions || []); }
            } catch { /* ignore */ }
          }
          if (!resolved) resolve([]);
        }
        child.kill();
      }, 10000);
    }).catch(() => resolve([]));
  });
}

// Delete a Claude session via the sidecar (removes JSONL files)
export async function deleteSessionViaSidecar(sessionId: string): Promise<void> {
  return new Promise((resolve) => {
    const command = Command.sidecar('binaries/agent-bridge');
    command.on('close', () => resolve());
    command.on('error', () => resolve());
    command.spawn().then(async (child) => {
      await child.write(JSON.stringify({ cmd: 'deleteSession', sessionId }) + '\n');
      setTimeout(() => { child.kill(); resolve(); }, 3000);
    }).catch(() => resolve());
  });
}

export interface SlashCommand {
  name: string;
  desc: string;
  source: string;
}

// List available commands/skills by scanning the filesystem via the sidecar
export async function listCommandsViaSidecar(projectPath?: string): Promise<SlashCommand[]> {
  return new Promise((resolve) => {
    const command = Command.sidecar('binaries/agent-bridge');
    let lineBuffer = '';
    let resolved = false;

    command.stdout.on('data', (data: string) => {
      lineBuffer += data;
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'commands') {
            resolved = true;
            resolve(parsed.commands || []);
          }
        } catch { /* ignore */ }
      }
    });

    command.on('close', () => { if (!resolved) resolve([]); });
    command.on('error', () => { if (!resolved) resolve([]); });

    command.spawn().then(async (child) => {
      await child.write(JSON.stringify({ cmd: 'listCommands', projectPath }) + '\n');
      setTimeout(() => {
        if (!resolved) {
          if (lineBuffer.trim()) {
            try {
              const parsed = JSON.parse(lineBuffer);
              if (parsed.type === 'commands') { resolved = true; resolve(parsed.commands || []); }
            } catch { /* ignore */ }
          }
          if (!resolved) resolve([]);
        }
        child.kill();
      }, 5000);
    }).catch(() => resolve([]));
  });
}

// Load session history via the sidecar's loadHistory command.
// Spawns a temporary sidecar, sends the command, collects the result, and kills it.
export async function loadHistoryViaSidecar(sessionId: string): Promise<StreamMessage[]> {
  return new Promise((resolve) => {
    const command = Command.sidecar('binaries/agent-bridge');
    let lineBuffer = '';
    let resolved = false;

    command.stdout.on('data', (data: string) => {
      lineBuffer += data;
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'history') {
            resolved = true;
            const messages: StreamMessage[] = (parsed.messages || []).map(
              (m: Record<string, unknown>) => ({
                type: m.type as StreamMessage['type'],
                content: (m.content as string) || '',
                toolName: m.toolName as string | undefined,
                toolInput: m.toolInput as Record<string, unknown> | undefined,
                toolResult: m.content as string | undefined,
                toolUseId: m.toolUseId as string | undefined,
                subtype: m.subtype as string | undefined,
                sessionId: m.sessionId as string | undefined,
                timestamp: Date.now(),
              } satisfies StreamMessage)
            );
            resolve(messages);
          }
        } catch {
          // ignore
        }
      }
    });

    command.on('close', () => {
      if (!resolved) resolve([]);
    });

    command.on('error', () => {
      if (!resolved) resolve([]);
    });

    command.spawn().then(async (child) => {
      const cmd = JSON.stringify({ cmd: 'loadHistory', sessionId });
      await child.write(cmd + '\n');
      // Give it time to respond, then kill
      setTimeout(() => {
        if (!resolved) {
          // Flush buffer
          if (lineBuffer.trim()) {
            try {
              const parsed = JSON.parse(lineBuffer);
              if (parsed.type === 'history') {
                resolved = true;
                const messages: StreamMessage[] = (parsed.messages || []).map(
                  (m: Record<string, unknown>) => ({
                    type: m.type as StreamMessage['type'],
                    content: (m.content as string) || '',
                    toolName: m.toolName as string | undefined,
                    toolInput: m.toolInput as Record<string, unknown> | undefined,
                    toolResult: m.content as string | undefined,
                    toolUseId: m.toolUseId as string | undefined,
                    subtype: m.subtype as string | undefined,
                    sessionId: m.sessionId as string | undefined,
                    timestamp: Date.now(),
                  } satisfies StreamMessage)
                );
                resolve(messages);
              }
            } catch { /* ignore */ }
          }
          if (!resolved) resolve([]);
        }
        child.kill();
      }, 10000);
    }).catch(() => resolve([]));
  });
}
