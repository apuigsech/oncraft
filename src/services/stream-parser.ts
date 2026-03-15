import type { StreamMessage } from '../types';

export function parseStreamLine(line: string): StreamMessage | null {
  if (!line.trim()) return null;

  try {
    const data = JSON.parse(line);

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
    console.warn('[ClaudBan] parse error:', line.substring(0, 200), e);
    return null;
  }
}
