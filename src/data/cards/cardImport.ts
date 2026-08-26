import { isCardType, type CardType } from '../../domain/cardType';

export interface ImportedCard {
  cardId: string;
  cardType: CardType;
  cardName: string;
  rarities: string[];
}

const fields = new Set(['cardId', 'cardType', 'cardName', 'rarities']);
const cardIdPattern = /^(?:\d{4}|P\d{3})$/;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function validateCardImport(input: unknown): ImportedCard[] {
  if (!Array.isArray(input)) throw new Error('Invalid card master input.');
  const cardsByIdentity = new Map<string, ImportedCard>();
  for (const value of input) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid card master input.');
    const card = value as Record<string, unknown>;
    if (Object.keys(card).some((key) => !fields.has(key)) || typeof card.cardId !== 'string' || !isCardType(card.cardType) || typeof card.cardName !== 'string' || !card.cardName.trim() || !Array.isArray(card.rarities) || card.rarities.length === 0 || card.rarities.some((rarity) => typeof rarity !== 'string' || !rarity.trim())) throw new Error('Invalid card master input.');

    const cardId = card.cardId.trim().toUpperCase();
    if (!cardIdPattern.test(cardId)) throw new Error('Invalid card master input.');
    const cardName = card.cardName.trim().normalize('NFC');
    const rarities = Array.from(new Set(
      card.rarities.map((rarity) => rarity.trim().toUpperCase()),
    )).sort(compareText);
    const identity = JSON.stringify([card.cardType, cardName, cardId]);
    const previous = cardsByIdentity.get(identity);
    if (previous) {
      previous.rarities = Array.from(new Set([...previous.rarities, ...rarities])).sort(compareText);
    } else {
      cardsByIdentity.set(identity, { cardId, cardType: card.cardType, cardName, rarities });
    }
  }
  return Array.from(cardsByIdentity.values()).sort((left, right) => (
    compareText(left.cardId, right.cardId)
    || compareText(left.cardType, right.cardType)
    || compareText(left.cardName, right.cardName)
  ));
}
