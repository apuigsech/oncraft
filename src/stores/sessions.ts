import { defineStore } from 'pinia';
import { ref, reactive } from 'vue';
import type { StreamMessage } from '../types';
import {
  executeClaudeTurn, killProcess, isProcessActive,
  checkClaudeBinary,
} from '../services/claude-process';
import { useCardsStore } from './cards';
import { useSettingsStore } from './settings';
import { useProjectsStore } from './projects';

export const useSessionsStore = defineStore('sessions', () => {
  const messages: Record<string, StreamMessage[]> = reactive({});
  const activeChatCardId = ref<string | null>(null);
  const claudeAvailable = ref<boolean | null>(null);
  const claudeError = ref<string | null>(null);

  function getMessages(cardId: string): StreamMessage[] {
    return messages[cardId] || [];
  }

  function appendMessage(cardId: string, msg: StreamMessage): void {
    if (!messages[cardId]) { messages[cardId] = []; }
    if (msg.type === 'system' && !msg.content) return;
    messages[cardId].push(msg);
  }

  async function verifyClaudeBinary(): Promise<boolean> {
    const settingsStore = useSettingsStore();
    const available = await checkClaudeBinary(settingsStore.settings.claudeBinaryPath);
    claudeAvailable.value = available;
    claudeError.value = available ? null : 'Claude Code not found. Install it or configure the binary path in Settings.';
    return available;
  }

  async function send(cardId: string, message: string): Promise<void> {
    console.log('[ClaudBan] send() called, cardId:', cardId, 'message:', message.substring(0, 50));
    const cardsStore = useCardsStore();
    const card = cardsStore.cards.find(c => c.id === cardId);
    appendMessage(cardId, { type: 'user', content: message, timestamp: Date.now() });

    if (isProcessActive(cardId)) {
      appendMessage(cardId, { type: 'system', content: 'Waiting for previous response to finish...', timestamp: Date.now() });
      return;
    }

    const project = useProjectsStore().activeProject;
    if (!project) return;

    if (!await verifyClaudeBinary()) {
      appendMessage(cardId, { type: 'system', content: claudeError.value || 'Claude not found', timestamp: Date.now() });
      return;
    }

    // Show a "thinking" indicator
    appendMessage(cardId, { type: 'system', content: 'Claude is thinking...', timestamp: Date.now() });
    await cardsStore.updateCardState(cardId, 'active');

    try {
      // Determine session ID for resume
      const sessionId = card?.sessionId && !card.sessionId.startsWith('pending-')
        ? card.sessionId : undefined;

      console.log('[ClaudBan] executing turn, sessionId:', sessionId || '(new)');

      // execute() waits for completion and returns the result
      const result = await executeClaudeTurn(cardId, project.path, message, sessionId);

      console.log('[ClaudBan] turn complete, type:', result.type, 'content:', result.content?.substring(0, 100));

      // Remove the "thinking" message
      const cardMessages = messages[cardId];
      if (cardMessages) {
        for (let i = cardMessages.length - 1; i >= 0; i--) {
          if (cardMessages[i].content === 'Claude is thinking...') {
            cardMessages.splice(i, 1);
            break;
          }
        }
      }

      // Capture session_id from result
      if (result.sessionId) {
        await cardsStore.updateCardSessionId(cardId, result.sessionId);
      }

      // Add the response
      appendMessage(cardId, result);

    } catch (err) {
      console.error('[ClaudBan] turn error:', err);
      appendMessage(cardId, { type: 'system', content: `Error: ${err}`, timestamp: Date.now() });
    }

    await cardsStore.updateCardState(cardId, 'idle');
    if (card) { card.lastActivityAt = new Date().toISOString(); }
  }

  async function stopSession(cardId: string): Promise<void> {
    await killProcess(cardId);
    const cardsStore = useCardsStore();
    await cardsStore.updateCardState(cardId, 'idle');
  }

  function openChat(cardId: string): void { activeChatCardId.value = cardId; }
  function closeChat(): void { activeChatCardId.value = null; }
  function isActive(cardId: string): boolean { return isProcessActive(cardId); }

  return {
    messages, activeChatCardId, claudeAvailable, claudeError,
    getMessages, verifyClaudeBinary, send, stopSession, openChat, closeChat, isActive,
  };
});
