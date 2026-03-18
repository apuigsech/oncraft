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
}

export interface ToolInvocationUIPart {
  type: 'dynamic-tool';
  toolName: string;
  toolCallId: string;
  state: 'input-available' | 'output-available' | 'approval-requested';
  input: unknown;
  output?: unknown;
}

export interface ImageUIPart {
  type: 'image';
  data: string;
  mediaType: string;
  name: string;
}

export type UIMessagePart = TextUIPart | ReasoningUIPart | ToolInvocationUIPart | ImageUIPart;

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
      const isAssistantRole = part.kind === 'assistant' || part.kind === 'tool_use' ||
        (part.kind === 'tool_confirmation' && part.resolved) ||
        (part.kind.startsWith('tool:') && part.resolved);

      if (part.kind === 'user') {
        if (currentAssistant) { result.push(currentAssistant); currentAssistant = null; }
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
            currentAssistant.parts.push({ type: 'reasoning', reasoning: (part.data.content as string) || '', state: 'done' });
          } else {
            currentAssistant.parts.push({
              type: 'text',
              text: (part.data.content as string) || '',
              state: part.data.streaming ? 'streaming' : 'done',
            });
          }
        } else if (part.kind === 'tool_use') {
          currentAssistant.parts.push({
            type: 'dynamic-tool',
            toolName: (part.data.toolName as string) || 'unknown',
            toolCallId: (part.data.toolUseId as string) || part.id,
            state: part.data.toolResult ? 'output-available' : 'input-available',
            input: part.data.toolInput || {},
            ...(part.data.toolResult ? { output: part.data.toolResult } : {}),
          });
        } else if (part.kind === 'tool_confirmation' || part.kind.startsWith('tool:')) {
          // Resolved tool confirmations / tool overrides — show as completed tool
          currentAssistant.parts.push({
            type: 'dynamic-tool',
            toolName: (part.data.toolName as string) || part.kind,
            toolCallId: (part.data.toolUseId as string) || part.id,
            state: 'output-available',
            input: part.data.toolInput || {},
          });
        }
      } else {
        // Non-conversation parts (hooks, errors, etc.) -> system UIMessage
        if (currentAssistant) { result.push(currentAssistant); currentAssistant = null; }
        const text = (part.data.content as string) || (part.data.message as string) ||
                     (part.data.summary as string) || (part.data.hookName as string) || part.kind;
        result.push({ id: part.id, role: 'system', parts: [{ type: 'text', text }] });
      }
    }

    if (currentAssistant) result.push(currentAssistant);
    return result;
  });
}
