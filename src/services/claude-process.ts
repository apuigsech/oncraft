import { Command } from '@tauri-apps/plugin-shell';
import type { StreamMessage } from '../types';
import { parseStreamLine } from './stream-parser';

interface SidecarProcess {
  write: (data: string) => Promise<void>;
  kill: () => void;
}

// Track running sidecar processes by cardId
const processes = new Map<string, SidecarProcess>();
const messageCallbacks = new Map<string, (msg: StreamMessage) => void>();

export function onMessage(cardId: string, callback: (msg: StreamMessage) => void): void {
  messageCallbacks.set(cardId, callback);
}

export function offMessage(cardId: string): void {
  messageCallbacks.delete(cardId);
}

function dispatchMessage(cardId: string, msg: StreamMessage): void {
  const cb = messageCallbacks.get(cardId);
  if (cb) cb(msg);
}

export async function spawnSession(
  cardId: string,
  projectPath: string,
  prompt: string,
  sessionId?: string,
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

  // Send the start command
  const startCmd = JSON.stringify({
    cmd: 'start',
    prompt,
    projectPath,
    ...(sessionId ? { sessionId } : {}),
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
}

export function isProcessActive(cardId: string): boolean {
  return processes.has(cardId);
}
