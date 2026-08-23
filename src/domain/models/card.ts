export interface Card {
  id: string;
  characterName?: string;
  rarity: string;
  /** @deprecated Read-only compatibility for pre-migration fixtures and documents. */
  nameZh?: string;
  /** @deprecated Read-only compatibility for pre-migration fixtures and documents. */
  nameJa?: string;
}

export function validateCard(card: Card) {
  if (typeof card.id !== 'string' || !/^\d{4}$/.test(card.id)) {
    throw new Error('Card id must be four digits.');
  }

  if (typeof card.characterName !== 'string' || card.characterName.trim().length === 0) {
    throw new Error('Card requires characterName.');
  }

  if (typeof card.rarity !== 'string' || card.rarity.length === 0) {
    throw new Error('Card requires rarity.');
  }
}
