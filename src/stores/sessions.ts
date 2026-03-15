import { defineStore } from 'pinia';
import { ref, reactive } from 'vue';
import type { StreamMessage } from '../types';
import {
  spawnSession, sendStart, sendReply, interrupt, killProcess,
  isProcessActive, isQueryActive, markQueryComplete,
  onMessage, offMessage,
} from '../services/claude-process';
import { useCardsStore } from './cards';

export const useSessionsStore = defineStore('sessions', () => {
  const messages: Record<string, StreamMessage[]> = reactive({});
  const activeChatCardId = ref<string | null>(null);
  const historyLoaded = new Set<string>(); // Track which cards have had history loaded

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

      // On result message, mark query complete and set card to idle
      if (msg.subtype === 'result') {
        markQueryComplete(cardId);
        cardsStore.updateCardState(cardId, 'idle');
        // Don't append empty result messages to chat
        if (!msg.content) return;
      }

      // On error, mark query complete and set card to error state
      if (msg.subtype === 'error') {
        markQueryComplete(cardId);
        cardsStore.updateCardState(cardId, 'error');
      }

      appendMessage(cardId, msg);
    });
  }

  async function send(cardId: string, message: string): Promise<void> {
    const cardsStore = useCardsStore();
    const card = cardsStore.cards.find(c => c.id === cardId);

    appendMessage(cardId, { type: 'user', content: message, timestamp: Date.now() });

    // Block only if a query is actively running (not just sidecar alive)
    if (isQueryActive(cardId)) {
      appendMessage(cardId, { type: 'system', content: 'Waiting for current response to finish...', timestamp: Date.now() });
      return;
    }

    const project = (await import('./projects')).useProjectsStore().activeProject;
    if (!project) return;

    await cardsStore.updateCardState(cardId, 'active');

    // Determine session ID for resume
    const sessionId = card?.sessionId && !card.sessionId.startsWith('pending-')
      ? card.sessionId : undefined;

    // If sidecar is already alive (previous query completed), reuse it
    // by sending a new start command. Otherwise spawn a fresh sidecar.
    if (isProcessActive(cardId)) {
      // Sidecar is idle — send a new start command to the existing process
      try {
        await sendStart(cardId, project.path, message, sessionId);
      } catch (err) {
        appendMessage(cardId, { type: 'system', content: `Error: ${err}`, timestamp: Date.now() });
        await cardsStore.updateCardState(cardId, 'idle');
      }
    } else {
      // No sidecar running — spawn a new one
      setupMessageListener(cardId);
      try {
        await spawnSession(cardId, project.path, message, sessionId);
      } catch (err) {
        appendMessage(cardId, { type: 'system', content: `Error: ${err}`, timestamp: Date.now() });
        await cardsStore.updateCardState(cardId, 'idle');
        offMessage(cardId);
      }
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

  async function openChat(cardId: string): Promise<void> {
    activeChatCardId.value = cardId;

    // Load history via sidecar SDK if we haven't already
    if (!historyLoaded.has(cardId) && (!messages[cardId] || messages[cardId].length === 0)) {
      const cardsStore = useCardsStore();
      const card = cardsStore.cards.find(c => c.id === cardId);
      if (card?.sessionId && !card.sessionId.startsWith('pending-')) {
        console.log('[ClaudBan] loading history for session:', card.sessionId);
        const { loadHistoryViaSidecar } = await import('../services/claude-process');
        const history = await loadHistoryViaSidecar(card.sessionId);
        console.log('[ClaudBan] loaded', history.length, 'messages from history');
        if (history.length > 0) {
          messages[cardId] = history;
        }
      }
      historyLoaded.add(cardId);
    }
  }
  function closeChat(): void { activeChatCardId.value = null; }
  function isActive(cardId: string): boolean { return isQueryActive(cardId); }

  return {
    messages, activeChatCardId,
    getMessages, send, approveToolUse, rejectToolUse,
    interruptSession, stopSession, openChat, closeChat, isActive,
  };
});
