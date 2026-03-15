import type { StreamMessage } from '../types';

export function parseStreamLine(line: string): StreamMessage | null {
  if (!line.trim()) return null;
  try {
    const data = JSON.parse(line);
    if (data.type === 'assistant' || data.type === 'text') {
      return { type: 'assistant', content: data.content || data.text || '', timestamp: Date.now() };
    }
    if (data.type === 'user') {
      return { type: 'user', content: data.content || data.text || '', timestamp: Date.now() };
    }
    if (data.type === 'tool_use') {
      return { type: 'tool_use', content: '', toolName: data.name || data.tool || '', toolInput: data.input || {}, timestamp: Date.now() };
    }
    if (data.type === 'tool_result') {
      return { type: 'tool_result', content: '', toolResult: typeof data.content === 'string' ? data.content : JSON.stringify(data.content), timestamp: Date.now() };
    }
    if (data.type === 'system') {
      return { type: 'system', content: data.content || data.message || '', sessionId: data.session_id || undefined, timestamp: Date.now() };
    }
    if (data.type === 'tool_confirmation' || data.type === 'permission_request') {
      return { type: 'tool_confirmation', content: data.message || data.content || '', toolName: data.tool || data.name || '', toolInput: data.input || {}, timestamp: Date.now() };
    }
    return { type: 'system', content: JSON.stringify(data), timestamp: Date.now() };
  } catch {
    return null;
  }
}
