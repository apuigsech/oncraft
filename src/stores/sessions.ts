import { defineStore } from 'pinia';
import { ref, reactive } from 'vue';
import type { StreamMessage } from '../types';
import {
  spawnSession, sendReply, interrupt, killProcess, isProcessActive, onMessage, offMessage,
} from '../services/claude-process';
import { useCardsStore } from './cards';

export const useSessionsStore = defineStore('sessions', () => {
  const messages: Record<string, StreamMessage[]> = reactive({});
  const activeChatCardId = ref<string | null>(null);

  function getMessages(cardId: string): StreamMessage[] {
    return messages[cardId] || [];
  }

  function appendMessage(cardId: string, msg: StreamMessage): void {
    if (!messages[cardId]) { messages[cardId] = []; }
    if (msg.type === 'system' && !msg.content && !msg.sessionId) return;
    messages[cardId].push(msg);
  }

  function setupMessageListener(cardId: string): void {
    onMessage(cardId, (msg: StreamMessage) => {
      const cardsStore = useCardsStore();

      // Capture session ID from init or result messages
      if (msg.sessionId) {
        cardsStore.updateCardSessionId(cardId, msg.sessionId);
      }

      // On result message, set card to idle
      if (msg.subtype === 'result') {
        cardsStore.updateCardState(cardId, 'idle');
        // Don't append empty result messages to chat
        if (!msg.content) return;
      }

      // On error, set card to error state
      if (msg.subtype === 'error') {
        cardsStore.updateCardState(cardId, 'error');
      }

      appendMessage(cardId, msg);
    });
  }

  async function send(cardId: string, message: string): Promise<void> {
    const cardsStore = useCardsStore();
    const card = cardsStore.cards.find(c => c.id === cardId);

    appendMessage(cardId, { type: 'user', content: message, timestamp: Date.now() });

    if (isProcessActive(cardId)) {
      appendMessage(cardId, { type: 'system', content: 'Waiting for current response to finish...', timestamp: Date.now() });
      return;
    }

    const project = (await import('./projects')).useProjectsStore().activeProject;
    if (!project) return;

    await cardsStore.updateCardState(cardId, 'active');

    // Set up listener before spawning so we don't miss early messages
    setupMessageListener(cardId);

    // Determine session ID for resume
    const sessionId = card?.sessionId && !card.sessionId.startsWith('pending-')
      ? card.sessionId : undefined;

    try {
      await spawnSession(cardId, project.path, message, sessionId);
    } catch (err) {
      appendMessage(cardId, { type: 'system', content: `Error: ${err}`, timestamp: Date.now() });
      await cardsStore.updateCardState(cardId, 'idle');
      offMessage(cardId);
    }
  }

  async function approveToolUse(cardId: string): Promise<void> {
    await sendReply(cardId, 'allow');
  }

  async function rejectToolUse(cardId: string): Promise<void> {
    await sendReply(cardId, 'deny');
  }

  async function interruptSession(cardId: string): Promise<void> {
    await interrupt(cardId);
  }

  async function stopSession(cardId: string): Promise<void> {
    offMessage(cardId);
    await killProcess(cardId);
    const cardsStore = useCardsStore();
    await cardsStore.updateCardState(cardId, 'idle');
  }

  function openChat(cardId: string): void { activeChatCardId.value = cardId; }
  function closeChat(): void { activeChatCardId.value = null; }
  function isActive(cardId: string): boolean { return isProcessActive(cardId); }

  return {
    messages, activeChatCardId,
    getMessages, send, approveToolUse, rejectToolUse,
    interruptSession, stopSession, openChat, closeChat, isActive,
  };
});
