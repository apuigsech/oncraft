import { v4 as uuidv4 } from 'uuid';
import type { Card, CardLinkedIssue } from '~/types';
import * as db from '~/services/database';

export const useCardsStore = defineStore('cards', () => {
  const cards = ref<Card[]>([]);
  const loadedProjectId = ref<string | null>(null);

  // N-2: Debounce DB writes for card updates.
  // During streaming, updateCardState and updateCardSessionId can fire
  // multiple times per second for the same card. We update the in-memory
  // state immediately but coalesce DB writes with a 500ms debounce per card.
  const _pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();

  function _debouncedDbWrite(card: Card): void {
    const existing = _pendingWrites.get(card.id);
    if (existing) clearTimeout(existing);
    _pendingWrites.set(card.id, setTimeout(async () => {
      _pendingWrites.delete(card.id);
      // Re-read from reactive array to get latest state
      const current = cards.value.find(c => c.id === card.id);
      if (current) await db.updateCard(current);
    }, 500));
  }

  // Flush a specific card's pending write immediately (e.g. before delete)
  function _flushDbWrite(cardId: string): void {
    const timer = _pendingWrites.get(cardId);
    if (timer) {
      clearTimeout(timer);
      _pendingWrites.delete(cardId);
      const card = cards.value.find(c => c.id === cardId);
      if (card) db.updateCard(card);
    }
  }

  function cardsByColumn(columnName: string): Card[] {
    return cards.value
      .filter(c => c.columnName === columnName && !c.archived)
      .sort((a, b) => {
        if (a.columnOrder !== b.columnOrder) return a.columnOrder - b.columnOrder;
        return new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime();
      });
  }

  async function loadForProject(projectId: string): Promise<void> {
    cards.value = await db.getCardsByProject(projectId);
    loadedProjectId.value = projectId;
  }

  async function addCard(
    projectId: string, columnName: string, name: string, description: string,
    useWorktree?: boolean, forkedFromId?: string,
  ): Promise<Card> {
    const columnCards = cards.value.filter(c => c.columnName === columnName);
    const worktreeName = useWorktree
      ? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      : undefined;
    const card: Card = {
      id: uuidv4(), projectId, name, description, columnName,
      columnOrder: columnCards.length, sessionId: '', state: 'idle', tags: [],
      createdAt: new Date().toISOString(), lastActivityAt: new Date().toISOString(), archived: false,
      useWorktree: useWorktree || false,
      worktreeName,
      forkedFromId,
    };
    await db.insertCard(card);
    cards.value.push(card);
    return card;
  }

  async function moveCardToColumn(
    cardId: string,
    toSlug: string,
    newOrder?: number,
  ): Promise<{ success: boolean; missingFiles?: string[] }> {
    const card = cards.value.find(c => c.id === cardId);
    if (!card) return { success: false };

    const fromSlug = card.columnName;
    if (fromSlug === toSlug) return { success: true };

    // requiredFiles gate
    const flowStore = useFlowStore();
    const missing = flowStore.checkRequiredFiles(toSlug, card.linkedFiles);
    if (missing.length > 0) return { success: false, missingFiles: missing };

    // Update fields + persist
    card.columnName = toSlug;
    card.columnOrder = newOrder ?? cardsByColumn(toSlug).length;
    card.lastActivityAt = new Date().toISOString();
    await db.updateCard(card);

    // Fire trigger prompt
    const sessionsStore = useSessionsStore();
    await sessionsStore.fireTriggerPrompt(cardId, fromSlug, toSlug);

    return { success: true };
  }

  // N-2: These hot-path functions update in-memory state immediately
  // but debounce the DB write to avoid IPC round-trips on every state change.
  async function updateCardState(cardId: string, state: Card['state']): Promise<void> {
    const card = cards.value.find(c => c.id === cardId);
    if (!card) return;
    card.state = state;
    card.lastActivityAt = new Date().toISOString();
    _debouncedDbWrite(card);
  }

  async function updateCardSessionId(cardId: string, sessionId: string): Promise<void> {
    const card = cards.value.find(c => c.id === cardId);
    if (!card) return;
    card.sessionId = sessionId;
    _debouncedDbWrite(card);
  }

  async function updateCardConsoleSessionId(cardId: string, consoleSessionId: string): Promise<void> {
    const card = cards.value.find(c => c.id === cardId);
    if (!card) return;
    card.consoleSessionId = consoleSessionId;
    _debouncedDbWrite(card);
  }

  function updateCardMetrics(cardId: string, metrics: { costUsd: number; inputTokens: number; outputTokens: number; durationMs: number }): void {
    const card = cards.value.find(c => c.id === cardId);
    if (!card) return;
    card.costUsd = metrics.costUsd;
    card.inputTokens = metrics.inputTokens;
    card.outputTokens = metrics.outputTokens;
    card.durationMs = metrics.durationMs;
    _debouncedDbWrite(card);
  }

  async function reorderColumn(columnName: string, cardIds: string[]): Promise<void> {
    await db.updateCardsColumn(cardIds, columnName);
    for (let i = 0; i < cardIds.length; i++) {
      const card = cards.value.find(c => c.id === cardIds[i]);
      if (card) { card.columnName = columnName; card.columnOrder = i; }
    }
  }

  async function applyColumnOrder(columnName: string, orderedCards: Card[]): Promise<void> {
    const updates: { id: string; columnName: string; columnOrder: number }[] = [];
    for (let i = 0; i < orderedCards.length; i++) {
      const card = cards.value.find(c => c.id === orderedCards[i].id);
      if (card) {
        card.columnName = columnName;
        card.columnOrder = i;
        updates.push({ id: card.id, columnName, columnOrder: i });
      }
    }
    if (updates.length > 0) {
      await db.batchUpdateCardPositions(updates);
    }
  }

  async function updateCardInfo(cardId: string, name: string, description: string): Promise<void> {
    const card = cards.value.find(c => c.id === cardId);
    if (!card) return;
    card.name = name;
    card.description = description;
    await db.updateCard(card);
  }

  async function updateCardLinkedFiles(cardId: string, linkedFiles: Record<string, string>): Promise<void> {
    const card = cards.value.find(c => c.id === cardId);
    if (!card) return;
    card.linkedFiles = Object.keys(linkedFiles).length > 0 ? linkedFiles : undefined;
    await db.updateCard(card);
  }

  async function updateCardLinkedIssues(cardId: string, linkedIssues: CardLinkedIssue[]): Promise<void> {
    const card = cards.value.find(c => c.id === cardId);
    if (!card) return;
    card.linkedIssues = linkedIssues.length > 0 ? linkedIssues : undefined;
    await db.updateCard(card);
  }

  async function archiveCard(cardId: string): Promise<void> {
    const card = cards.value.find(c => c.id === cardId);
    if (!card) return;
    card.archived = true;
    await db.updateCard(card);
  }

  async function unarchiveCard(cardId: string): Promise<void> {
    const card = cards.value.find(c => c.id === cardId);
    if (!card) return;
    card.archived = false;
    await db.updateCard(card);
  }

  async function removeCard(cardId: string): Promise<void> {
    // N-2: Cancel any pending debounced write — card is being deleted
    const pendingTimer = _pendingWrites.get(cardId);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      _pendingWrites.delete(cardId);
    }
    await db.deleteCard(cardId);
    cards.value = cards.value.filter(c => c.id !== cardId);
  }

  return {
    cards, loadedProjectId, cardsByColumn, loadForProject,
    addCard, moveCardToColumn, updateCardState, updateCardSessionId, updateCardConsoleSessionId,
    updateCardMetrics, updateCardInfo,
    updateCardLinkedFiles, updateCardLinkedIssues,
    reorderColumn, applyColumnOrder, archiveCard, unarchiveCard, removeCard,
  };
});
