import { defineStore } from 'pinia';
import { ref, reactive } from 'vue';
import type { StreamMessage } from '../types';
import {
  spawnClaudeSession, resumeClaudeSession,
  killProcess, isProcessActive,
  checkClaudeBinary, updateSessionId,
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
    // Skip empty system messages (hooks that only carry session_id)
    if (msg.type === 'system' && !msg.content) {
      // Still process sessionId side-effect but don't add to visible messages
      return;
    }
    messages[cardId].push(msg);
  }

  async function verifyClaudeBinary(): Promise<boolean> {
    const settingsStore = useSettingsStore();
    const available = await checkClaudeBinary(settingsStore.settings.claudeBinaryPath);
    claudeAvailable.value = available;
    claudeError.value = available ? null : 'Claude Code not found. Install it or configure the binary path in Settings.';
    return available;
  }

  async function startSession(cardId: string, projectPath: string, prompt: string): Promise<string> {
    const settingsStore = useSettingsStore();
    const cardsStore = useCardsStore();
    const claudeBinary = settingsStore.settings.claudeBinaryPath;
    if (!await verifyClaudeBinary()) {
      throw new Error(claudeError.value || 'Claude Code not available');
    }
    const sessionId = await spawnClaudeSession(
      cardId, projectPath, claudeBinary,
      (msg) => {
        if (msg.sessionId) {
          updateSessionId(cardId, msg.sessionId);
          cardsStore.updateCardSessionId(cardId, msg.sessionId);
        }
        appendMessage(cardId, msg);
      },
      (code) => { cardsStore.updateCardState(cardId, code === 0 ? 'idle' : 'error'); },
      prompt,
    );
    await cardsStore.updateCardState(cardId, 'active');
    await cardsStore.updateCardSessionId(cardId, sessionId);
    return sessionId;
  }

  async function resumeSession(cardId: string, sessionId: string, projectPath: string, prompt: string): Promise<void> {
    const settingsStore = useSettingsStore();
    const cardsStore = useCardsStore();
    const claudeBinary = settingsStore.settings.claudeBinaryPath;
    await resumeClaudeSession(
      cardId, sessionId, projectPath, claudeBinary,
      (msg) => {
        if (msg.sessionId) {
          updateSessionId(cardId, msg.sessionId);
          cardsStore.updateCardSessionId(cardId, msg.sessionId);
        }
        appendMessage(cardId, msg);
      },
      (code) => { cardsStore.updateCardState(cardId, code === 0 ? 'idle' : 'error'); },
      prompt,
    );
    await cardsStore.updateCardState(cardId, 'active');
  }

  async function send(cardId: string, message: string): Promise<void> {
    const cardsStore = useCardsStore();
    const card = cardsStore.cards.find(c => c.id === cardId);
    appendMessage(cardId, { type: 'user', content: message, timestamp: Date.now() });

    // If a process is still running (previous turn), wait for it or kill it
    if (isProcessActive(cardId)) {
      appendMessage(cardId, { type: 'system', content: 'Waiting for previous response to finish...', timestamp: Date.now() });
      return;
    }

    const project = useProjectsStore().activeProject;
    if (!project) return;
    const settingsStore = useSettingsStore();
    const claudeBinary = settingsStore.settings.claudeBinaryPath;
    if (!await verifyClaudeBinary()) {
      appendMessage(cardId, { type: 'system', content: claudeError.value || 'Claude not found', timestamp: Date.now() });
      return;
    }

    const onMessage = (msg: StreamMessage) => {
      // Capture session_id first (even from empty hook messages)
      if (msg.sessionId) {
        updateSessionId(cardId, msg.sessionId);
        cardsStore.updateCardSessionId(cardId, msg.sessionId);
      }
      appendMessage(cardId, msg);
    };
    const onExit = (code: number) => {
      cardsStore.updateCardState(cardId, code === 0 ? 'idle' : 'error');
    };

    // Each message spawns a new `claude -p` process.
    // Use --resume with real session_id for conversation continuity.
    if (card?.sessionId && !card.sessionId.startsWith('pending-')) {
      await resumeClaudeSession(cardId, card.sessionId, project.path, claudeBinary, onMessage, onExit, message);
    } else {
      await spawnClaudeSession(cardId, project.path, claudeBinary, onMessage, onExit, message);
    }
    await cardsStore.updateCardState(cardId, 'active');

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
    getMessages, verifyClaudeBinary, startSession,
    resumeSession, send, stopSession, openChat, closeChat, isActive,
  };
});
