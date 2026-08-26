import { describe, expect, it } from 'vitest';
import { developmentCards } from './developmentCards';

describe('development card seed data', () => {
  it('contains normalized card metadata with no private content fields', () => {
    const murofuCards = developmentCards.filter((card) =>
      card.cardName.includes('諸伏'),
    );

    expect(murofuCards.length).toBeGreaterThanOrEqual(2);
    expect(new Set(murofuCards.flatMap((card) => card.rarities)).size).toBeGreaterThanOrEqual(2);

    for (const card of developmentCards) {
      expect(Object.keys(card).sort()).toEqual(['key', 'cardId', 'cardType', 'cardName', 'rarities'].sort());
      expect(card).not.toHaveProperty('imageUrl');
      expect(card).not.toHaveProperty('imageUrls');
      expect(card).not.toHaveProperty('effectText');
    }
  });
});
