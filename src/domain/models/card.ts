import { isCardType, type CardType } from '../cardType';
import { isCompleteCardId } from '../cardId';

export interface Card {
  key: string;
  cardId: string;
  cardType: CardType;
  cardName: string;
  rarities: readonly string[];
}

export function validateCard(card: Card) {
  if (typeof card.key !== 'string' || card.key.length === 0) {
    throw new Error('Card requires key.');
  }

  if (typeof card.cardId !== 'string' || !isCompleteCardId(card.cardId)) {
    throw new Error('Card requires a complete cardId.');
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
