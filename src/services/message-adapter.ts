/**
 * Adapter that converts ClaudBan's StreamMessage[] into Vercel AI SDK UIMessage[]
 * for consumption by Nuxt UI Chat components (UChatMessages, UChatMessage).
 *
 * The key challenge: our StreamMessage is flat (one message = one type), but
 * UIMessage expects a message with multiple `parts` (text + tool + reasoning).
 * We group consecutive assistant messages into a single UIMessage with parts.
 */
import type { StreamMessage } from '../types';

// ─── Vercel AI SDK part types (inline to avoid deep import issues) ─────────

export interface TextUIPart {
  type: 'text';
  text: string;
  state?: 'streaming' | 'done';
}

export interface ReasoningUIPart {
  type: 'reasoning';
  reasoning: string;
  state?: 'streaming' | 'done';
}

export interface ToolInvocationUIPart {
  type: 'dynamic-tool';
  toolName: string;
  toolCallId: string;
  state: 'input-available' | 'output-available' | 'approval-requested';
  input: unknown;
  output?: unknown;
  errorText?: string;
}

export type UIMessagePart = TextUIPart | ReasoningUIPart | ToolInvocationUIPart;

export interface UIMessage {
  id: string;
  role: 'system' | 'user' | 'assistant';
  parts: UIMessagePart[];
  metadata?: Record<string, unknown>;
}

// ─── Status mapping ────────────────────────────────────────────────────────

/**
 * Map ClaudBan's isActive + message state to UChatMessages `status` prop.
 */
export function toChatStatus(isActive: boolean, messages: StreamMessage[]): 'ready' | 'submitted' | 'streaming' {
  if (!isActive) return 'ready';
  const last = messages[messages.length - 1];
  if (last?.subtype === 'streaming') return 'streaming';
  return 'submitted';
}

// ─── Message conversion ────────────────────────────────────────────────────

/**
 * Convert our flat StreamMessage[] into UIMessage[] for UChatMessages.
 *
 * Grouping logic:
 * - Each `user` message becomes its own UIMessage with a text part
 * - Each `system` message (with content) becomes its own UIMessage
 * - Consecutive `assistant`/`tool_use`/`tool_confirmation` messages are grouped
 *   into a single UIMessage with multiple parts (text, reasoning, tool parts)
 * - A new `user` message breaks the current assistant group
 */
export function toUIMessages(messages: StreamMessage[]): UIMessage[] {
  const result: UIMessage[] = [];
  let currentAssistant: UIMessage | null = null;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.type === 'user') {
      // Flush any pending assistant group
      if (currentAssistant) {
        result.push(currentAssistant);
        currentAssistant = null;
      }
      result.push({
        id: `user-${i}`,
        role: 'user',
        parts: [{ type: 'text', text: msg.content }],
      });
    } else if (msg.type === 'system' && msg.content) {
      if (currentAssistant) {
        result.push(currentAssistant);
        currentAssistant = null;
      }
      result.push({
        id: `system-${i}`,
        role: 'system',
        parts: [{ type: 'text', text: msg.content }],
      });
    } else if (msg.type === 'assistant') {
      // Start or extend the current assistant group
      if (!currentAssistant) {
        currentAssistant = {
          id: `assistant-${i}`,
          role: 'assistant',
          parts: [],
        };
      }

      if (msg.subtype === 'thinking') {
        currentAssistant.parts.push({
          type: 'reasoning',
          reasoning: msg.content,
          state: 'done',
        });
      } else {
        // Check if last part is text — if streaming, extend it; otherwise add new
        const lastPart = currentAssistant.parts[currentAssistant.parts.length - 1];
        if (lastPart && lastPart.type === 'text' && msg.subtype === 'streaming') {
          // The streaming text already gets appended in the store,
          // so we just update the state and text of the last part
          lastPart.text = msg.content;
          lastPart.state = 'streaming';
        } else {
          currentAssistant.parts.push({
            type: 'text',
            text: msg.content,
            state: msg.subtype === 'streaming' ? 'streaming' : 'done',
          });
        }
      }
    } else if (msg.type === 'tool_use' || msg.type === 'tool_confirmation') {
      // Tool calls are parts of the current assistant turn
      if (!currentAssistant) {
        currentAssistant = {
          id: `assistant-${i}`,
          role: 'assistant',
          parts: [],
        };
      }

      const state: ToolInvocationUIPart['state'] =
        msg.type === 'tool_confirmation'
          ? 'approval-requested'
          : msg.toolResult
            ? 'output-available'
            : 'input-available';

      currentAssistant.parts.push({
        type: 'dynamic-tool',
        toolName: msg.toolName || 'unknown',
        toolCallId: msg.toolUseId || `tool-${i}`,
        state,
        input: msg.toolInput || {},
        ...(msg.toolResult ? { output: msg.toolResult } : {}),
      });

      // Store the original StreamMessage index in metadata for tool approval
      if (!currentAssistant.metadata) currentAssistant.metadata = {};
      (currentAssistant.metadata as Record<string, unknown>)[`tool-${i}-originalIndex`] = i;
    }
  }

  // Flush last assistant group
  if (currentAssistant) {
    result.push(currentAssistant);
  }

  return result;
}
