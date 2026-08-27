import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  collection: vi.fn(),
  connectFirestoreEmulator: vi.fn(),
  getDocs: vi.fn(),
  getDocsFromServer: vi.fn(),
  getFirestore: vi.fn(() => ({ type: 'firestore' })),
}));

vi.mock('firebase/firestore', () => firestore);

import { listCards, listCardsFromServer, searchCards } from './cardRepository';
import { cardConverter } from '../converters';
import { collections } from '../paths';
import type { Card } from '../../../domain/models';

describe('card repository', () => {
  const convertedCollection = { type: 'converted-cards' };
  const withConverter = vi.fn(() => convertedCollection);

  beforeEach(() => {
    vi.clearAllMocks();
    firestore.collection.mockReturnValue({ withConverter });
  });

  it('lists cards through the cards collection and card converter', async () => {
    const cards: Card[] = [
      { key: '0001', cardId: '0001', cardType: 'character', cardName: '江戶川柯南', rarities: ['R'] },
    ];
    firestore.getDocs.mockResolvedValue({ docs: cards.map((card) => ({ data: () => card })) });

    await expect(listCards()).resolves.toEqual(cards);

    expect(firestore.collection).toHaveBeenCalledWith(expect.anything(), collections.cards);
    expect(withConverter).toHaveBeenCalledWith(cardConverter);
    expect(firestore.getDocs).toHaveBeenCalledWith(convertedCollection);
  });

  it('uses a rejecting server-only read for public Card Master error handling', async () => {
    const unavailable = new Error('Firestore unavailable');
    firestore.getDocsFromServer.mockRejectedValue(unavailable);

    await expect(listCardsFromServer()).rejects.toBe(unavailable);

    expect(firestore.getDocsFromServer).toHaveBeenCalledWith(convertedCollection);
    expect(firestore.getDocs).not.toHaveBeenCalled();
  });

  it('merges legacy and composite-key cards by canonical identity without merging same-ID different names', async () => {
    const legacyCard: Card = {
      key: '0501', cardId: '0501', cardType: 'character', cardName: '諸伏高明', rarities: ['D'],
    };
    const compositeCard: Card = {
      key: 'card_abc', cardId: '0501', cardType: 'character', cardName: '諸伏高明', rarities: ['SR', 'D'],
    };
    const sameIdDifferentName: Card = {
      key: 'card_def', cardId: '0501', cardType: 'character', cardName: '諸伏景光', rarities: ['R'],
    };
    const sameIdDifferentType: Card = {
      key: 'card_ghi', cardId: '0501', cardType: 'event', cardName: '諸伏高明', rarities: ['C'],
    };
    firestore.getDocs.mockResolvedValue({
      docs: [legacyCard, compositeCard, sameIdDifferentName, sameIdDifferentType].map((card) => ({ data: () => card })),
    });

    await expect(listCards()).resolves.toEqual([
      { key: 'card_def', cardId: '0501', cardType: 'character', cardName: '諸伏景光', rarities: ['R'] },
      { key: 'card_abc', cardId: '0501', cardType: 'character', cardName: '諸伏高明', rarities: ['D', 'SR'] },
      { key: 'card_ghi', cardId: '0501', cardType: 'event', cardName: '諸伏高明', rarities: ['C'] },
    ]);
  });

  it('matches normalized Chinese names and returns all matching rarities', () => {
    const cards: Card[] = [
      { key: '0001', cardId: '0001', cardType: 'character', cardName: '諸伏景光', rarities: ['R'] },
      { key: '0002', cardId: '0002', cardType: 'character', cardName: '諸伏高明', rarities: ['SR'] },
      { key: '0003', cardId: '0003', cardType: 'character', cardName: '江戶川柯南', rarities: ['UR'] },
    ];

    expect(searchCards(cards, '  諸伏  ')).toEqual(cards.slice(0, 2));
    expect(new Set(searchCards(cards, '諸伏').flatMap((card) => card.rarities))).toEqual(
      new Set(['R', 'SR']),
    );
  });

  it('matches normalized Japanese names', () => {
    const cards: Card[] = [
      { key: '0001', cardId: '0001', cardType: 'character', cardName: '江戸川コナン', rarities: ['R'] },
      { key: '0002', cardId: '0002', cardType: 'character', cardName: '毛利 蘭', rarities: ['SR'] },
    ];

    expect(searchCards(cards, '江戸川')).toEqual([cards[0]]);
    expect(searchCards(cards, '毛利蘭')).toEqual([cards[1]]);
  });

  it('returns every card for an empty or whitespace-only query', () => {
    const cards: readonly Card[] = [{ key: '0001', cardId: '0001', cardType: 'character', cardName: '柯南', rarities: ['R'] }];

    expect(searchCards(cards, '')).toEqual(cards);
    expect(searchCards(cards, '   ')).toEqual(cards);
  });
});
