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
  // Buffer for partial lines — Tauri may deliver chunks mid-JSON
  let stdoutBuffer = '';

  command.stdout.on('data', (chunk: string) => {
    stdoutBuffer += chunk;
    // Process complete lines
    const lines = stdoutBuffer.split('\n');
    // Keep the last element (may be incomplete)
    stdoutBuffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const msg = parseStreamLine(line);
      if (msg) {
        console.log('[ClaudBan] parsed:', msg.type, msg.content?.substring(0, 100) || '(no content)', msg.sessionId || '');
        onMessage(msg);
      }
    }
  });
  command.stderr.on('data', (line: string) => {
    console.log('[ClaudBan] stderr:', line.substring(0, 300));
  });
  command.on('close', (data) => {
    // Flush remaining buffer
    if (stdoutBuffer.trim()) {
      const msg = parseStreamLine(stdoutBuffer);
      if (msg) {
        console.log('[ClaudBan] parsed (flush):', msg.type, msg.content?.substring(0, 100) || '');
        onMessage(msg);
      }
    }
    console.log('[ClaudBan] process closed with code:', data.code);
    activeProcesses.delete(cardId);
    onExit(data.code ?? 0);
  });
  command.on('error', (error) => {
    console.error('[ClaudBan] process error:', error);
    activeProcesses.delete(cardId);
    onMessage({ type: 'system', content: `Process error: ${error}`, timestamp: Date.now() });
    onExit(1);
  });
}

// Scope names configured in capabilities/default.json
const CLAUDE_SCOPE_NAMES = ['claude', 'claude-homebrew', 'claude-usr-local'];
let resolvedScopeName: string | null = null;

export async function checkClaudeBinary(_claudeBinary: string): Promise<boolean> {
  for (const scopeName of CLAUDE_SCOPE_NAMES) {
    try {
      const cmd = Command.create(scopeName, ['--version']);
      const output = await cmd.execute();
      if (output.code === 0) {
        resolvedScopeName = scopeName;
        return true;
      }
    } catch {
      // try next
    }
  }
  resolvedScopeName = null;
  return false;
}

function getScopeName(): string {
  return resolvedScopeName || 'claude';
}

// Each user message spawns a new `claude -p` process.
// For conversation continuity, we use --resume with the session_id from the first turn.
export async function spawnClaudeSession(
  cardId: string, projectPath: string, _claudeBinary: string,
  onMessage: (msg: StreamMessage) => void, onExit: (code: number) => void,
  prompt: string,
): Promise<string> {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', prompt];
  const command = Command.create(getScopeName(), args, { cwd: projectPath });
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
  prompt: string,
): Promise<void> {
  const args = ['-p', '--resume', sessionId, '--output-format', 'stream-json', '--verbose', prompt];
  const command = Command.create(getScopeName(), args, { cwd: projectPath });
  setupCommand(cardId, command, onMessage, onExit);
  const child = await command.spawn();
  const proc: ClaudeProcess = { sessionId, child, onMessage, onExit };
  activeProcesses.set(cardId, proc);
}

// sendMessage is no longer used for stdin — each message spawns a new process.
// Kept for potential future use with --input-format stream-json.
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
