import { describe, expect, it } from 'vitest';
import type { Card } from './models';
import {
  getCardIdsForMetadata,
  getCardNameSuggestions,
  getRaritiesForMetadata,
  hasKnownCardMetadata,
} from './cardMetadata';

const cards: readonly Card[] = [
  { id: '1001', cardType: 'character', cardName: '江戶川柯南', rarities: ['R'] },
  { id: '1100', cardType: 'event', cardName: '追跡開始', rarities: ['C'] },
  { id: '1200', cardType: 'case', cardName: '緋色の真相', rarities: ['C'] },
  { id: '1167', cardType: 'partner', cardName: '江戶川柯南', rarities: ['P'] },
];

describe('card metadata', () => {
  it('narrows metadata candidates within the selected card type', () => {
    expect(getCardNameSuggestions(cards, 'event', '追')).toEqual(['追跡開始']);
    expect(getRaritiesForMetadata(cards, 'case', '緋色の真相')).toEqual(['C']);
    expect(getCardIdsForMetadata(cards, 'partner', '江戶川柯南', 'P')).toEqual(['1167']);
  });

  it('recognizes only a complete known type-aware metadata combination', () => {
    expect(hasKnownCardMetadata(cards, {
      cardType: 'event', cardName: '追跡開始', rarity: 'C', cardId: '1100',
    })).toBe(true);
    expect(hasKnownCardMetadata(cards, {
      cardType: 'character', cardName: '江戶川柯南', rarity: 'P', cardId: '1167',
    })).toBe(false);
  });
});
