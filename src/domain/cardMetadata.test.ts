import { describe, expect, it } from 'vitest';
import type { Card } from './models';
import {
  getCardIdsForMetadata,
  getCardNameSuggestions,
  getCharacterNameSuggestions,
  getRaritiesForMetadata,
  getRaritiesForCharacter,
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

  it('adapts legacy character-only helper calls without changing their results', () => {
    const legacyCards = [
      { id: '0338', characterName: '諸伏景光', rarities: ['R', 'CP'] },
      { id: '0590', characterName: '諸伏景光', rarities: ['R'] },
    ] as never;

    expect(getCharacterNameSuggestions(legacyCards, '諸伏')).toEqual(['諸伏景光']);
    expect(getRaritiesForCharacter(legacyCards, '諸伏景光')).toEqual(['CP', 'R']);
    expect(getCardIdsForMetadata(legacyCards, '諸伏景光', 'R')).toEqual(['0338', '0590']);
    expect(hasKnownCardMetadata(legacyCards, {
      cardId: '0590', characterName: '諸伏景光', rarity: 'R',
    })).toBe(true);
  });
});
