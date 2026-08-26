import { isCardType, type CardType } from '../../domain/cardType';

export interface ImportedCard {
  cardId: string;
  cardType: CardType;
  cardName: string;
  rarities: string[];
}

const fields = new Set(['cardId', 'cardType', 'cardName', 'rarities']);

export function validateCardImport(input: unknown): ImportedCard[] {
  if (!Array.isArray(input)) throw new Error('Invalid card master input.');
  const cardsById = new Map<string, ImportedCard>();
  for (const value of input) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid card master input.');
    const card = value as Record<string, unknown>;
    if (Object.keys(card).some((key) => !fields.has(key)) || typeof card.cardId !== 'string' || !/^\d{4}$/.test(card.cardId) || !isCardType(card.cardType) || typeof card.cardName !== 'string' || !card.cardName.trim() || !Array.isArray(card.rarities) || card.rarities.length === 0 || card.rarities.some((rarity) => typeof rarity !== 'string' || !rarity.trim())) throw new Error('Invalid card master input.');

    const cardName = card.cardName.trim();
    const previous = cardsById.get(card.cardId);
    if (previous && (previous.cardType !== card.cardType || previous.cardName !== cardName)) {
      throw new Error('Invalid card master input.');
    }
    const rarities = Array.from(new Set(card.rarities.map((rarity) => rarity.trim()))).sort();
    if (previous) previous.rarities = Array.from(new Set([...previous.rarities, ...rarities])).sort();
    else cardsById.set(card.cardId, { cardId: card.cardId, cardType: card.cardType, cardName, rarities });
  }
  return Array.from(cardsById.values());
}
