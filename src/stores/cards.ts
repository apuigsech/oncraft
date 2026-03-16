import { defineStore } from 'pinia';
import { ref } from 'vue';
import { v4 as uuidv4 } from 'uuid';
import type { Card } from '../types';
import * as db from '../services/database';

export const useCardsStore = defineStore('cards', () => {
  const cards = ref<Card[]>([]);
  const loadedProjectId = ref<string | null>(null);

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
    projectId: string, columnName: string, name: string, description: string
  ): Promise<Card> {
    const columnCards = cards.value.filter(c => c.columnName === columnName);
    const card: Card = {
      id: uuidv4(), projectId, name, description, columnName,
      columnOrder: columnCards.length, sessionId: '', state: 'idle', tags: [],
      createdAt: new Date().toISOString(), lastActivityAt: new Date().toISOString(), archived: false,
    };
    await db.insertCard(card);
    cards.value.push(card);
    return card;
  }

  async function moveCard(cardId: string, toColumn: string, newOrder: number): Promise<void> {
    const card = cards.value.find(c => c.id === cardId);
    if (!card) return;
    card.columnName = toColumn;
    card.columnOrder = newOrder;
    card.lastActivityAt = new Date().toISOString();
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
