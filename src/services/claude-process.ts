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

// Scope names configured in src-tauri/capabilities/default.json
// Each maps to a different path for the claude binary
const CLAUDE_SCOPE_NAMES = ['claude', 'claude-homebrew', 'claude-usr-local'];

let resolvedScopeName: string | null = null;

export async function checkClaudeBinary(_claudeBinary: string): Promise<boolean> {
  // Try each configured scope name until one works
  for (const scopeName of CLAUDE_SCOPE_NAMES) {
    try {
      const cmd = Command.create(scopeName, ['--version']);
      const output = await cmd.execute();
      if (output.code === 0) {
        resolvedScopeName = scopeName;
        return true;
      }
    } catch {
      // This scope name didn't work, try next
    }
  }
  resolvedScopeName = null;
  return false;
}

function getScopeName(): string {
  return resolvedScopeName || 'claude';
}

export async function spawnClaudeSession(
  cardId: string, projectPath: string, _claudeBinary: string,
  onMessage: (msg: StreamMessage) => void, onExit: (code: number) => void,
): Promise<string> {
  const command = Command.create(getScopeName(), ['--output-format', 'stream-json', '--verbose'], { cwd: projectPath });
  setupCommand(cardId, command, onMessage, onExit);
  const child = await command.spawn();
  const sessionId = `pending-${cardId}`;
  const proc: ClaudeProcess = { sessionId, child, onMessage, onExit };
  activeProcesses.set(cardId, proc);
  return sessionId;
}

export async function resumeClaudeSession(
  cardId: string, sessionId: string, projectPath: string, _claudeBinary: string,
  onMessage: (msg: StreamMessage) => void, onExit: (code: number) => void,
): Promise<void> {
  const command = Command.create(getScopeName(), ['--resume', sessionId, '--output-format', 'stream-json', '--verbose'], { cwd: projectPath });
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
