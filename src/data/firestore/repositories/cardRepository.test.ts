import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  collection: vi.fn(),
  getDocs: vi.fn(),
  getFirestore: vi.fn(() => ({ type: 'firestore' })),
}));

vi.mock('firebase/firestore', () => firestore);

import { listCards, searchCards } from './cardRepository';
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
      { id: 'BT-001', nameZh: '江戶川柯南', nameJa: '江戸川コナン', rarity: 'R' },
    ];
    firestore.getDocs.mockResolvedValue({ docs: cards.map((card) => ({ data: () => card })) });

    await expect(listCards()).resolves.toEqual(cards);

    expect(firestore.collection).toHaveBeenCalledWith(expect.anything(), collections.cards);
    expect(withConverter).toHaveBeenCalledWith(cardConverter);
    expect(firestore.getDocs).toHaveBeenCalledWith(convertedCollection);
  });

  it('matches normalized Chinese names and returns all matching rarities', () => {
    const cards: Card[] = [
      { id: 'BT-001', nameZh: '諸伏景光', nameJa: '諸伏景光', rarity: 'R' },
      { id: 'BT-002', nameZh: '諸伏高明', nameJa: '諸伏高明', rarity: 'SR' },
      { id: 'BT-003', nameZh: '江戶川柯南', nameJa: '江戸川コナン', rarity: 'UR' },
    ];

    expect(searchCards(cards, '  諸伏  ')).toEqual(cards.slice(0, 2));
    expect(new Set(searchCards(cards, '諸伏').map((card) => card.rarity))).toEqual(
      new Set(['R', 'SR']),
    );
  });

  it('matches normalized Japanese names', () => {
    const cards: Card[] = [
      { id: 'BT-001', nameZh: '江戶川柯南', nameJa: '江戸川コナン', rarity: 'R' },
      { id: 'BT-002', nameZh: '毛利蘭', nameJa: '毛利 蘭', rarity: 'SR' },
    ];

    expect(searchCards(cards, '江戸川')).toEqual([cards[0]]);
    expect(searchCards(cards, '毛利蘭')).toEqual([cards[1]]);
  });

  it('returns every card for an empty or whitespace-only query', () => {
    const cards: readonly Card[] = [{ id: 'BT-001', nameZh: '柯南', rarity: 'R' }];

    expect(searchCards(cards, '')).toEqual(cards);
    expect(searchCards(cards, '   ')).toEqual(cards);
  });
});
