import { describe, expect, it } from 'vitest';
import type { Card } from './models';
import {
  getCardsForMetadata,
  getCardIdsForMetadata,
  getCardNameSuggestions,
  getCharacterNameSuggestions,
  getRaritiesForMetadata,
  getRaritiesForCharacter,
  hasKnownCardMetadata,
} from './cardMetadata';

const cards: readonly Card[] = [
  { key: 'card_a', cardId: '0501', cardType: 'character', cardName: '諸伏高明', rarities: ['D'] },
  { key: 'card_b', cardId: '0501', cardType: 'event', cardName: '事件 0501', rarities: ['D'] },
  { key: 'card_c', cardId: 'P001', cardType: 'partner', cardName: '江戶川柯南', rarities: ['P'] },
];

describe('card metadata', () => {
  it('narrows metadata candidates within the selected card type', () => {
    expect(getCardNameSuggestions(cards, 'event', '事')).toEqual(['事件 0501']);
    expect(getRaritiesForMetadata(cards, 'event', '事件 0501')).toEqual(['D']);
    expect(getCardIdsForMetadata(cards, 'partner', '江戶川柯南', 'P')).toEqual(['P001']);
  });

  it('returns the matching normalized card when visible IDs are shared', () => {
    expect(getCardsForMetadata(cards, 'character', '諸伏高明', 'D')).toEqual([cards[0]]);
    expect(getCardsForMetadata(cards, 'event', '事件 0501', 'D')).toEqual([cards[1]]);
  });

  it('recognizes only a complete known type-aware metadata combination', () => {
    expect(hasKnownCardMetadata(cards, {
      cardType: 'event', cardName: '事件 0501', rarity: 'D', cardId: '0501',
    })).toBe(true);
    expect(hasKnownCardMetadata(cards, {
      cardType: 'character', cardName: '江戶川柯南', rarity: 'P', cardId: 'P001',
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
