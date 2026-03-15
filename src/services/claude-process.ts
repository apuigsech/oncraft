import { Command } from '@tauri-apps/plugin-shell';
import type { StreamMessage } from '../types';
import { parseStreamLine } from './stream-parser';

// Track running processes by cardId
const runningCards = new Set<string>();

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

// Execute a single Claude turn using `execute()` which waits for completion.
// Returns the parsed result message.
export async function executeClaudeTurn(
  cardId: string,
  projectPath: string,
  prompt: string,
  sessionId?: string,
): Promise<StreamMessage> {
  const args = ['-p', '--output-format', 'json'];
  if (sessionId) {
    args.push('--resume', sessionId);
  }
  args.push(prompt);

  console.log('[ClaudBan] executing claude turn, args:', args.join(' ').substring(0, 200));
  console.log('[ClaudBan] cwd:', projectPath);

  runningCards.add(cardId);

  try {
    const command = Command.create(getScopeName(), args, { cwd: projectPath });
    const output = await command.execute();

    console.log('[ClaudBan] execute completed, code:', output.code);
    console.log('[ClaudBan] stdout length:', output.stdout.length, 'preview:', output.stdout.substring(0, 300));
    if (output.stderr) {
      console.log('[ClaudBan] stderr:', output.stderr.substring(0, 300));
    }

    // Parse the JSON result
    const msg = parseStreamLine(output.stdout);
    if (msg) {
      return msg;
    }

    // If parsing failed, return raw output as system message
    return {
      type: 'system',
      content: output.stdout || `Process exited with code ${output.code}`,
      timestamp: Date.now(),
    };
  } catch (err) {
    console.error('[ClaudBan] execute error:', err);
    return {
      type: 'system',
      content: `Error: ${err}`,
      timestamp: Date.now(),
    };
  } finally {
    runningCards.delete(cardId);
  }
}

export function isProcessActive(cardId: string): boolean {
  return runningCards.has(cardId);
}

export function updateSessionId(_cardId: string, _sessionId: string): void {
  // No-op for execute mode — session ID comes from the result
}

export async function killProcess(_cardId: string): Promise<void> {
  // Cannot kill execute() — it's awaited. In the future with spawn(), we can.
  runningCards.delete(_cardId);
}
