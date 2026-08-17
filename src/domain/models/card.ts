export interface Card {
  id: string;
  nameZh?: string;
  nameJa?: string;
  rarity: string;
}

export function validateCard(card: Card) {
  if (!card.id) {
    throw new Error('Card requires id.');
  }

  if (!card.nameZh && !card.nameJa) {
    throw new Error('Card requires nameZh or nameJa.');
  }

  if (!card.rarity) {
    throw new Error('Card requires rarity.');
  }
}
