import { describe, expect, it } from 'vitest';
import type { Card } from '../../domain/models';
import { searchCards } from './cardSearch';

describe('searchCards', () => {
  it('matches normalized card names with whitespace-insensitive queries', () => {
    const cards: readonly Card[] = [
      { id: '0001', cardType: 'character', cardName: '江戶川柯南', rarities: ['R'] },
      { id: '1100', cardType: 'event', cardName: '追跡開始', rarities: ['C'] },
    ];

    expect(searchCards(cards, '追 跡')).toEqual([cards[1]]);
  });
});
