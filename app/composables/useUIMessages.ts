import type { ChatPart } from '~/types';

// Vercel AI SDK part types (inline to avoid deep import issues)

export interface TextUIPart {
  type: 'text';
  text: string;
  state?: 'streaming' | 'done';
}

export interface ReasoningUIPart {
  type: 'reasoning';
  reasoning: string;
  state?: 'streaming' | 'done';
  streaming?: boolean;
}

export interface ToolInvocationUIPart {
  type: 'dynamic-tool';
  toolName: string;
  toolCallId: string;
  state: 'input-available' | 'output-available' | 'approval-requested';
  input: unknown;
  output?: unknown;
  streaming?: boolean;
  loading?: boolean;
}

export interface ImageUIPart {
  type: 'image';
  data: string;
  mediaType: string;
  name: string;
}

// For resolved action-bar parts and other ChatParts rendered via registry component
export interface ChatPartUIPart {
  type: 'chat-part';
  chatPart: ChatPart;
}

export type UIMessagePart = TextUIPart | ReasoningUIPart | ToolInvocationUIPart | ImageUIPart | ChatPartUIPart;

export interface UIMessage {
  id: string;
  role: 'system' | 'user' | 'assistant';
  parts: UIMessagePart[];
}

export function useUIMessages(inlineParts: Ref<ChatPart[]>): ComputedRef<UIMessage[]> {
  return computed(() => {
    const result: UIMessage[] = [];
    let currentAssistant: UIMessage | null = null;

    for (const part of inlineParts.value) {
      const isAssistantRole = (part.kind === 'assistant' || part.kind === 'tool_use') && part.kind !== 'tool_use:Agent';

      if (part.kind === 'user') {
        if (currentAssistant) { result.push(currentAssistant); currentAssistant = null; }

        // Synthetic user messages render as SyntheticBadge (via chat-part)
        if (part.data.isSynthetic) {
          const syntheticPart = { ...part, kind: 'user:synthetic' };
          result.push({ id: part.id, role: 'assistant', parts: [{ type: 'chat-part', chatPart: syntheticPart }] });
          continue;
        }

        const userParts: UIMessagePart[] = [];
        const images = part.data.images as Array<{ data: string; mediaType: string; name: string }> | undefined;
        if (images?.length) {
          for (const img of images) {
            userParts.push({ type: 'image', data: img.data, mediaType: img.mediaType, name: img.name });
          }
        }
        userParts.push({ type: 'text', text: (part.data.content as string) || '' });
        result.push({ id: part.id, role: 'user', parts: userParts });
      } else if (isAssistantRole) {
        if (!currentAssistant) {
          currentAssistant = { id: part.id, role: 'assistant', parts: [] };
        }
        // Map to UIMessagePart based on kind
        if (part.kind === 'assistant') {
          if (part.data.thinking) {
            const isThinkingStreaming = !!part.data.thinkingStreaming;
            currentAssistant.parts.push({
              type: 'reasoning',
              reasoning: (part.data.content as string) || '',
              state: isThinkingStreaming ? 'streaming' : 'done',
              streaming: isThinkingStreaming,
            });
          } else {
            currentAssistant.parts.push({
              type: 'text',
              text: (part.data.content as string) || '',
              state: part.data.streaming ? 'streaming' : 'done',
            });
          }
        } else if (part.kind === 'tool_use') {
          const hasResult = !!part.data.toolResult;
          currentAssistant.parts.push({
            type: 'dynamic-tool',
            toolName: (part.data.toolName as string) || 'unknown',
            toolCallId: (part.data.toolUseId as string) || part.id,
            state: hasResult ? 'output-available' : 'input-available',
            input: part.data.toolInput || {},
            ...(hasResult ? { output: part.data.toolResult } : {}),
            streaming: !hasResult,
            loading: !hasResult,
          });
        }
      } else if (part.kind === 'tool_use:Agent') {
        // SubagentBlock renders as its own component via registry
        if (currentAssistant) { result.push(currentAssistant); currentAssistant = null; }
        result.push({ id: part.id, role: 'assistant', parts: [{ type: 'chat-part', chatPart: part }] });
      } else if (part.placement === 'action-bar' && part.resolved && part.kind === 'tool_confirmation') {
        // Resolved tool_confirmation (normal tools only): render as tool block (same style as tool_use)
        // so that post-decision tool widgets look identical to normal tool calls.
        // Excludes tool_confirmation:AskUserQuestion which renders via UserQuestionBar.
        if (!currentAssistant) {
          currentAssistant = { id: part.id, role: 'assistant', parts: [] };
        }
        const hasResult = !!part.data.toolResult;
        currentAssistant.parts.push({
          type: 'dynamic-tool',
          toolName: (part.data.toolName as string) || 'unknown',
          toolCallId: (part.data.toolUseId as string) || part.id,
          state: hasResult ? 'output-available' : 'input-available',
          input: part.data.toolInput || {},
          ...(hasResult ? { output: part.data.toolResult } : {}),
          streaming: false,
          loading: false,
        });
      } else {
        // Non-conversation parts (hooks, errors, resolved actions, etc.)
        if (currentAssistant) { result.push(currentAssistant); currentAssistant = null; }

        // Resolved action-bar parts and other non-text parts: render via registry component
        if (part.placement === 'action-bar' && part.resolved) {
          result.push({ id: part.id, role: 'assistant', parts: [{ type: 'chat-part', chatPart: part }] });
        } else {
          const text = (part.data.content as string) || (part.data.message as string) ||
                       (part.data.summary as string) || (part.data.hookName as string) || part.kind;
          result.push({ id: part.id, role: 'system', parts: [{ type: 'text', text }] });
        }
      }
    }

    if (currentAssistant) result.push(currentAssistant);
    return result;
  });
}
