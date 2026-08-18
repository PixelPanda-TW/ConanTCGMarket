import { describe, expect, it } from 'vitest';
import { developmentCards } from './developmentCards';

describe('development card seed data', () => {
  it('contains multiple 諸伏 cards with preserved rarity and no private content fields', () => {
    const murofuCards = developmentCards.filter((card) =>
      [card.nameZh, card.nameJa].some((name) => name?.includes('諸伏')),
    );

    expect(murofuCards.length).toBeGreaterThanOrEqual(2);
    expect(new Set(murofuCards.map((card) => card.rarity)).size).toBeGreaterThanOrEqual(2);

    for (const card of developmentCards) {
      expect(Object.keys(card).sort()).toEqual(['id', 'nameJa', 'nameZh', 'rarity'].sort());
      expect(card).not.toHaveProperty('imageUrl');
      expect(card).not.toHaveProperty('imageUrls');
      expect(card).not.toHaveProperty('effectText');
    }
  });
});
