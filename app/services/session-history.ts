import { readTextFile } from '@tauri-apps/plugin-fs';
import { homeDir } from '@tauri-apps/api/path';
import type { StreamMessage } from '~/types';

/**
 * Load chat history from Claude Code's JSONL session files.
 * Claude stores sessions at: ~/.claude/projects/{encoded-path}/{session-id}.jsonl
 */
export async function loadSessionHistory(
  projectPath: string,
  sessionId: string,
): Promise<StreamMessage[]> {
  let home = await homeDir();
  // Ensure trailing slash
  if (!home.endsWith('/')) home += '/';
  // Claude encodes project paths by replacing / and . with -
  // The leading / becomes a leading - (e.g. /Users/foo.bar -> -Users-foo-bar)
  const encodedPath = projectPath.replace(/[/.]/g, '-');
  const jsonlPath = `${home}.claude/projects/${encodedPath}/${sessionId}.jsonl`;

  if (import.meta.dev) console.log('[ClaudBan] loading session history from:', jsonlPath);

  try {
    const content = await readTextFile(jsonlPath);
    const lines = content.split('\n').filter(l => l.trim());
    const messages: StreamMessage[] = [];

    for (const line of lines) {
      try {
        const data = JSON.parse(line);

        if (data.type === 'user' && data.message) {
          const text = typeof data.message.content === 'string'
            ? data.message.content
            : Array.isArray(data.message.content)
              ? data.message.content
                  .filter((b: { type: string }) => b.type === 'text')
                  .map((b: { text: string }) => b.text)
                  .join('\n')
              : '';
          if (text) {
            messages.push({
              type: 'user',
              content: text,
              timestamp: data.timestamp ? new Date(data.timestamp).getTime() : Date.now(),
            });
          }
        }

        if (data.type === 'assistant' && data.message) {
          const content = data.message.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'text' && block.text) {
                messages.push({
                  type: 'assistant',
                  content: block.text,
                  timestamp: data.timestamp ? new Date(data.timestamp).getTime() : Date.now(),
                });
              }
              if (block.type === 'tool_use') {
                messages.push({
                  type: 'tool_use',
                  content: '',
                  toolName: block.name || '',
                  toolInput: block.input || {},
                  toolUseId: block.id,
                  timestamp: data.timestamp ? new Date(data.timestamp).getTime() : Date.now(),
                });
              }
            }
          }
        }

        if (data.type === 'tool_result' || (data.type === 'user' && data.message?.content && Array.isArray(data.message.content))) {
          // Tool results in Claude's JSONL are stored as user messages with tool_result content blocks
          const contentBlocks = data.message?.content;
          if (Array.isArray(contentBlocks)) {
            for (const block of contentBlocks) {
              if (block.type === 'tool_result') {
                const resultText = typeof block.content === 'string'
                  ? block.content
                  : Array.isArray(block.content)
                    ? block.content.map((c: { text?: string }) => c.text || '').join('\n')
                    : JSON.stringify(block.content);
                messages.push({
                  type: 'tool_result',
                  content: '',
                  toolResult: resultText.substring(0, 500), // Truncate long results
                  toolUseId: block.tool_use_id,
                  timestamp: data.timestamp ? new Date(data.timestamp).getTime() : Date.now(),
                });
              }
            }
          }
        }
      } catch {
        // Skip unparseable lines
      }
    }

    if (import.meta.dev) console.log('[ClaudBan] loaded', messages.length, 'messages from history');
    return messages;
  } catch (err) {
    if (import.meta.dev) console.warn('[ClaudBan] could not load session history:', err);
    return [];
  }
}
