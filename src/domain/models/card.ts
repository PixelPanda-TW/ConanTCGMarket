import { isCardType, type CardType } from '../cardType';

export interface Card {
  id: string;
  cardType: CardType;
  cardName: string;
  rarities: readonly string[];
}

export function validateCard(card: Card) {
  if (typeof card.id !== 'string' || !/^\d{4}$/.test(card.id)) {
    throw new Error('Card id must be four digits.');
  }

  if (!isCardType(card.cardType)) {
    throw new Error('Card requires a supported cardType.');
  }

  if (typeof card.cardName !== 'string' || card.cardName.trim().length === 0) {
    throw new Error('Card requires cardName.');
  }

  const hasRarities = Array.isArray(card.rarities) && card.rarities.length > 0
    && card.rarities.every((rarity) => typeof rarity === 'string' && rarity.trim().length > 0);
  if (!hasRarities) {
    throw new Error('Card requires rarity.');
  }
}
