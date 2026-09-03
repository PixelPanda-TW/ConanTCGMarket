import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  collection: vi.fn(),
  connectFirestoreEmulator: vi.fn(),
  getDocs: vi.fn(),
  getDocsFromCache: vi.fn(),
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

  it('uses the server result first for public Card Master freshness', async () => {
    const cards: Card[] = [
      { key: '0501', cardId: '0501', cardType: 'character', cardName: '諸伏高明', rarities: ['D'] },
    ];
    firestore.getDocsFromServer.mockResolvedValue({
      docs: cards.map((card) => ({ data: () => card })),
    });

    await expect(listCardsFromServer()).resolves.toEqual(cards);

    expect(firestore.getDocsFromCache).not.toHaveBeenCalled();
  });

  it('falls back to a non-empty Card Master cache after a server failure', async () => {
    const unavailable = new Error('Firestore unavailable');
    firestore.getDocsFromServer.mockRejectedValue(unavailable);
    const cachedCards: Card[] = [
      { key: '1096', cardId: '1096', cardType: 'character', cardName: '諸伏景光', rarities: ['R'] },
    ];
    firestore.getDocsFromCache.mockResolvedValue({
      docs: cachedCards.map((card) => ({ data: () => card })),
    });

    await expect(listCardsFromServer()).resolves.toEqual(cachedCards);

    expect(firestore.getDocsFromServer).toHaveBeenCalledWith(convertedCollection);
    expect(firestore.getDocsFromCache).toHaveBeenCalledWith(convertedCollection);
  });

  it.each([
    ['an empty cache', { docs: [] }],
    ['a failing cache', new Error('Cache unavailable')],
  ] as const)('rethrows the original server error for %s', async (_name, cacheResult) => {
    const unavailable = new Error('Firestore unavailable');
    firestore.getDocsFromServer.mockRejectedValue(unavailable);
    if (cacheResult instanceof Error) firestore.getDocsFromCache.mockRejectedValue(cacheResult);
    else firestore.getDocsFromCache.mockResolvedValue(cacheResult);

    await expect(listCardsFromServer()).rejects.toBe(unavailable);
  });

  it('retains every canonical record and sorts without hiding duplicate identities', async () => {
    const duplicateB: Card = {
      key: 'card_b', cardId: '0501', cardType: 'character', cardName: '諸伏高明', rarities: ['D'],
    };
    const laterCard: Card = {
      key: 'card_z', cardId: '1096', cardType: 'character', cardName: '諸伏景光', rarities: ['R'],
    };
    const duplicateA: Card = {
      key: 'card_a', cardId: '0501', cardType: 'character', cardName: '諸伏高明', rarities: ['D'],
    };
    firestore.getDocs.mockResolvedValue({
      docs: [duplicateB, laterCard, duplicateA].map((card) => ({ data: () => card })),
    });

    await expect(listCards()).resolves.toEqual([duplicateA, duplicateB, laterCard]);
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
