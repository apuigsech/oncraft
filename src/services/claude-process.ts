import { Command } from '@tauri-apps/plugin-shell';
import type { StreamMessage } from '../types';
import { parseStreamLine } from './stream-parser';

export interface ClaudeProcess {
  sessionId: string;
  child: Awaited<ReturnType<Command<string>['spawn']>>;
  onMessage: (msg: StreamMessage) => void;
  onExit: (code: number) => void;
}

const activeProcesses = new Map<string, ClaudeProcess>();

export function getActiveProcess(cardId: string): ClaudeProcess | undefined {
  return activeProcesses.get(cardId);
}

function setupCommand(
  cardId: string,
  command: Command<string>,
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
    onExit(data.code ?? 1);
  });
  command.on('error', (error) => {
    activeProcesses.delete(cardId);
    onMessage({ type: 'system', content: `Process error: ${error}`, timestamp: Date.now() });
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
  cardId: string, projectPath: string, claudeBinary: string,
  onMessage: (msg: StreamMessage) => void, onExit: (code: number) => void,
): Promise<string> {
  const command = Command.create(claudeBinary, ['--output-format', 'stream-json', '--verbose'], { cwd: projectPath });
  setupCommand(cardId, command, onMessage, onExit);
  const child = await command.spawn();
  const sessionId = `pending-${cardId}`;
  const proc: ClaudeProcess = { sessionId, child, onMessage, onExit };
  activeProcesses.set(cardId, proc);
  return sessionId;
}

export async function resumeClaudeSession(
  cardId: string, sessionId: string, projectPath: string, claudeBinary: string,
  onMessage: (msg: StreamMessage) => void, onExit: (code: number) => void,
): Promise<void> {
  const command = Command.create(claudeBinary, ['--resume', sessionId, '--output-format', 'stream-json', '--verbose'], { cwd: projectPath });
  setupCommand(cardId, command, onMessage, onExit);
  const child = await command.spawn();
  const proc: ClaudeProcess = { sessionId, child, onMessage, onExit };
  activeProcesses.set(cardId, proc);
}

export async function sendMessage(cardId: string, message: string): Promise<void> {
  const proc = activeProcesses.get(cardId);
  if (!proc) throw new Error(`No active process for card ${cardId}`);
  await proc.child.write(message + '\n');
}

export function updateSessionId(cardId: string, sessionId: string): void {
  const proc = activeProcesses.get(cardId);
  if (proc) { proc.sessionId = sessionId; }
}

export async function killProcess(cardId: string): Promise<void> {
  const proc = activeProcesses.get(cardId);
  if (proc) { await proc.child.kill(); activeProcesses.delete(cardId); }
}

export function isProcessActive(cardId: string): boolean {
  return activeProcesses.has(cardId);
}
