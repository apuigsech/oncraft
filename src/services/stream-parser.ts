import type { StreamMessage } from '../types';

export function parseStreamLine(line: string): StreamMessage | null {
  if (!line.trim()) return null;

  try {
    const data = JSON.parse(line);

    // System messages (init, hooks, etc.)
    if (data.type === 'system') {
      // Skip hook noise
      if (data.subtype === 'hook_started' || data.subtype === 'hook_response') {
        // Still extract session_id from init if present
        if (data.session_id) {
          return { type: 'system', content: '', sessionId: data.session_id, timestamp: Date.now() };
        }
        return null;
      }
      return {
        type: 'system',
        content: data.subtype === 'init' ? 'Session started' : (data.content || data.message || data.subtype || ''),
        sessionId: data.session_id || undefined,
        timestamp: Date.now(),
      };
    }

    // Assistant messages — real format: { type: "assistant", message: { content: [{ type: "text", text: "..." }] } }
    if (data.type === 'assistant') {
      const msg = data.message;
      if (msg && msg.content && Array.isArray(msg.content)) {
        const texts: string[] = [];
        for (const block of msg.content) {
          if (block.type === 'text') {
            texts.push(block.text);
          } else if (block.type === 'tool_use') {
            return {
              type: 'tool_use',
              content: '',
              toolName: block.name || '',
              toolInput: block.input || {},
              timestamp: Date.now(),
            };
          }
        }
        if (texts.length > 0) {
          return { type: 'assistant', content: texts.join('\n'), timestamp: Date.now() };
        }
      }
      // Fallback for simpler format
      if (data.content) {
        return { type: 'assistant', content: String(data.content), timestamp: Date.now() };
      }
      return null;
    }

    // Result message — final summary
    if (data.type === 'result') {
      if (data.is_error) {
        const errorMsg = data.errors?.join('; ') || data.result || 'Unknown error';
        return { type: 'system', content: `Error: ${errorMsg}`, sessionId: data.session_id || undefined, timestamp: Date.now() };
      }
      return {
        type: 'system',
        content: data.result ? 'Done' : '',
        sessionId: data.session_id || undefined,
        timestamp: Date.now(),
      };
    }

    // User messages (echoed back)
    if (data.type === 'user') {
      return { type: 'user', content: data.content || data.text || '', timestamp: Date.now() };
    }

    // Tool results
    if (data.type === 'tool_result') {
      return {
        type: 'tool_result',
        content: '',
        toolResult: typeof data.content === 'string' ? data.content : JSON.stringify(data.content),
        timestamp: Date.now(),
      };
    }

    // Tool confirmation
    if (data.type === 'tool_confirmation' || data.type === 'permission_request') {
      return { type: 'tool_confirmation', content: data.message || data.content || '', toolName: data.tool || data.name || '', toolInput: data.input || {}, timestamp: Date.now() };
    }

    // Unknown — ignore silently
    return null;
  } catch {
    return null;
  }
}
