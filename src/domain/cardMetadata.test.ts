import { describe, expect, it } from 'vitest';
import {
  getCardIdsForMetadata,
  getCharacterNameSuggestions,
  getRaritiesForCharacter,
  hasKnownCardMetadata,
} from './cardMetadata';

describe('card metadata', () => {
  it('narrows card metadata candidates and supports a legacy rarity', () => {
    const cards = [
      { id: '0338', characterName: '諸伏景光', rarities: ['R', 'CP'] },
      { id: '0590', characterName: '諸伏景光', rarity: 'R' },
      { id: '1010', characterName: '諸伏高明', rarities: ['SR'] },
    ];

    expect(getCharacterNameSuggestions(cards, '諸伏')).toEqual(['諸伏景光', '諸伏高明']);
    expect(getRaritiesForCharacter(cards, '諸伏景光')).toEqual(['CP', 'R']);
    expect(getCardIdsForMetadata(cards, '諸伏景光', 'R')).toEqual(['0338', '0590']);
    expect(hasKnownCardMetadata(cards, { cardId: '0590', characterName: '諸伏景光', rarity: 'R' })).toBe(true);
  });
});
