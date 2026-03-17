import type { StreamMessage, AgentProgressEvent } from '~/types';

// Subtypes that come from the SDK as internal progress/status events.
// These should NOT be shown as chat messages — they feed the progress tracker.
const PROGRESS_SUBTYPES = new Set([
  'task_started', 'task_progress', 'task_notification', 'status',
]);

export function isProgressEvent(data: Record<string, unknown>): boolean {
  // Matches: { type: 'system', subtype: 'task_started'|'task_progress'|... }
  // or top-level { type: 'task_started' | 'task_progress' | ... }
  if (data.type === 'system' && typeof data.subtype === 'string' && PROGRESS_SUBTYPES.has(data.subtype)) return true;
  if (typeof data.type === 'string' && PROGRESS_SUBTYPES.has(data.type)) return true;
  return false;
}

export function parseProgressEvent(data: Record<string, unknown>): AgentProgressEvent {
  const subtype = (data.subtype || data.type) as string;
  // Extract a human-readable message from common fields
  const content = (
    (data.message as string) ||
    (data.content as string) ||
    (data.text as string) ||
    (data.description as string) ||
    subtype
  );
  return { subtype, content, timestamp: Date.now(), raw: data };
}

export function parseStreamLine(line: string): StreamMessage | null {
  if (!line.trim()) return null;

  try {
    const data = JSON.parse(line);

    // Progress events are handled separately — do not emit as chat messages
    if (isProgressEvent(data)) return null;

    if (data.type === 'assistant') {
      return {
        type: 'assistant',
        content: data.content || '',
        subtype: data.subtype,
        usage: data.usage,
        timestamp: Date.now(),
      };
    }

    if (data.type === 'tool_use') {
      return {
        type: 'tool_use',
        content: '',
        toolName: data.toolName || '',
        toolInput: data.toolInput || {},
        toolUseId: data.toolUseId,
        timestamp: Date.now(),
      };
    }

    if (data.type === 'tool_confirmation') {
      return {
        type: 'tool_confirmation',
        content: data.content || '',
        toolName: data.toolName || '',
        toolInput: data.toolInput || {},
        toolUseId: data.toolUseId,
        timestamp: Date.now(),
      };
    }

    if (data.type === 'tool_result') {
      return {
        type: 'tool_result',
        content: '',
        toolResult: typeof data.content === 'string' ? data.content : JSON.stringify(data.content),
        toolUseId: data.toolUseId,
        timestamp: Date.now(),
      };
    }

    if (data.type === 'result') {
      return {
        type: 'system',
        content: '',
        subtype: 'result',
        sessionId: data.sessionId,
        costUsd: data.costUsd,
        durationMs: data.durationMs,
        usage: data.usage,
        timestamp: Date.now(),
      };
    }

    if (data.type === 'error') {
      return {
        type: 'system',
        content: data.message || 'Unknown error',
        subtype: 'error',
        retryAfter: data.retryAfter,
        timestamp: Date.now(),
      };
    }

    if (data.type === 'system') {
      if (data.subtype === 'init') {
        return {
          type: 'system',
          content: data.content || '',
          subtype: 'init',
          sessionId: data.sessionId,
          gitBranch: data.gitBranch,
          worktreePath: data.worktreePath,
          worktreeBranch: data.worktreeBranch,
          timestamp: Date.now(),
        };
      }
      return {
        type: 'system',
        content: data.content || '',
        subtype: data.subtype,
        sessionId: data.sessionId,
        timestamp: Date.now(),
      };
    }

    // Unknown type — pass through
    return {
      type: 'system',
      content: `[${data.type}] ${JSON.stringify(data)}`,
      timestamp: Date.now(),
    };
  } catch (e) {
    if (import.meta.dev) console.warn('[OnCraft] parse error:', line.substring(0, 200), e);
    return null;
  }
}
