export interface Card {
  id: string;
  nameZh?: string;
  nameJa?: string;
  rarity: string;
}

export function validateCard(card: Card) {
  if (typeof card.id !== 'string' || card.id.length === 0) {
    throw new Error('Card requires id.');
  }

  if (card.nameZh !== undefined && typeof card.nameZh !== 'string') {
    throw new Error('Card nameZh must be a string when provided.');
  }

  if (card.nameJa !== undefined && typeof card.nameJa !== 'string') {
    throw new Error('Card nameJa must be a string when provided.');
  }

  if (!card.nameZh && !card.nameJa) {
    throw new Error('Card requires nameZh or nameJa.');
  }

  if (typeof card.rarity !== 'string' || card.rarity.length === 0) {
    throw new Error('Card requires rarity.');
  }
}
