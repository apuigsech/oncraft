import { defineStore } from 'pinia';
import { ref, computed, type ComputedRef } from 'vue';
import { v4 as uuidv4 } from 'uuid';
import type { Card } from '../types';
import * as db from '../services/database';

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 50) || 'worktree';
}

export const useCardsStore = defineStore('cards', () => {
  const cards = ref<Card[]>([]);
  const loadedProjectId = ref<string | null>(null);

  // Memoized computed cache per column — avoids re-filtering/sorting all columns on every mutation
  const _columnCache = new Map<string, ComputedRef<Card[]>>();

  function cardsByColumn(columnName: string): Card[] {
    if (!_columnCache.has(columnName)) {
      _columnCache.set(columnName, computed(() =>
        cards.value
          .filter(c => c.columnName === columnName && !c.archived)
          .sort((a, b) => {
            if (a.columnOrder !== b.columnOrder) return a.columnOrder - b.columnOrder;
            return new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime();
          })
      ));
    }
    return _columnCache.get(columnName)!.value;
  }

  async function loadForProject(projectId: string): Promise<void> {
    _columnCache.clear(); // Clear memoization cache when switching projects
    cards.value = await db.getCardsByProject(projectId);
    loadedProjectId.value = projectId;
  }

  async function addCard(
    projectId: string, columnName: string, name: string, description: string,
    options?: { useWorktree?: boolean }
  ): Promise<Card> {
    const columnCards = cards.value.filter(c => c.columnName === columnName);
    const useWorktree = options?.useWorktree ?? false;
    const card: Card = {
      id: uuidv4(), projectId, name, description, columnName,
      columnOrder: columnCards.length, sessionId: '', state: 'idle', tags: [],
      createdAt: new Date().toISOString(), lastActivityAt: new Date().toISOString(), archived: false,
      useWorktree,
      worktreeName: useWorktree ? slugify(name) : undefined,
    };
    await db.insertCard(card);
    cards.value.push(card);
    return card;
  }

  async function moveCard(cardId: string, toColumn: string, newIndex: number): Promise<void> {
    const card = cards.value.find(c => c.id === cardId);
    if (!card) return;

    const fromColumn = card.columnName;

    // Remove card from its current column order
    const fromCards = cards.value
      .filter(c => c.columnName === fromColumn && !c.archived && c.id !== cardId)
      .sort((a, b) => a.columnOrder - b.columnOrder);

    // Update card to its new column
    card.columnName = toColumn;
    card.lastActivityAt = new Date().toISOString();

    // Build target column ordered list with the card inserted at newIndex
    const toCards = fromColumn === toColumn
      ? fromCards // same column: card was already removed
      : cards.value
          .filter(c => c.columnName === toColumn && !c.archived && c.id !== cardId)
          .sort((a, b) => a.columnOrder - b.columnOrder);

    toCards.splice(newIndex, 0, card);

    // Reindex destination column
    const updates: { id: string; columnName: string; columnOrder: number }[] = [];
    for (let i = 0; i < toCards.length; i++) {
      toCards[i].columnOrder = i;
      toCards[i].columnName = toColumn;
      updates.push({ id: toCards[i].id, columnName: toColumn, columnOrder: i });
    }

    // Reindex source column if cross-column move
    if (fromColumn !== toColumn) {
      for (let i = 0; i < fromCards.length; i++) {
        fromCards[i].columnOrder = i;
        updates.push({ id: fromCards[i].id, columnName: fromColumn, columnOrder: i });
      }
    }

    await db.batchUpdateCardPositions(updates);
    // Persist the moved card's updated lastActivityAt
    await db.updateCard(card);
  }

  async function updateCardState(cardId: string, state: Card['state']): Promise<void> {
    const card = cards.value.find(c => c.id === cardId);
    if (!card) return;
    card.state = state;
    card.lastActivityAt = new Date().toISOString();
    await db.updateCard(card);
  }

  async function updateCardSessionId(cardId: string, sessionId: string): Promise<void> {
    const card = cards.value.find(c => c.id === cardId);
    if (!card) return;
    card.sessionId = sessionId;
    await db.updateCard(card);
  }

  async function reorderColumn(columnName: string, cardIds: string[]): Promise<void> {
    await db.updateCardsColumn(cardIds, columnName);
    for (let i = 0; i < cardIds.length; i++) {
      const card = cards.value.find(c => c.id === cardIds[i]);
      if (card) { card.columnName = columnName; card.columnOrder = i; }
    }
  }

  /** Apply the ordered list from vue-draggable-plus v-model to the store + DB */
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
    await db.deleteCard(cardId);
    cards.value = cards.value.filter(c => c.id !== cardId);
  }

  return {
    cards, loadedProjectId, cardsByColumn, loadForProject,
    addCard, moveCard, updateCardState, updateCardSessionId, updateCardInfo,
    reorderColumn, applyColumnOrder, archiveCard, unarchiveCard, removeCard,
  };
});
