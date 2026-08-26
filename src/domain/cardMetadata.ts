import type { CardType } from './cardType';
import type { Card } from './models';

export interface CardMetadataValue {
  cardType: CardType;
  cardName: string;
  rarity: string;
  cardId: string;
}

function matchesCardType(card: Card, cardType: CardType): boolean {
  return card.cardType === cardType;
}

export function getCardNameSuggestions(cards: readonly Card[], cardType: CardType, query: string): string[] {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return [];

  return [...new Set(cards
    .filter((card) => matchesCardType(card, cardType))
    .map((card) => card.cardName)
    .filter((name) => name.startsWith(normalizedQuery)))];
}

export function getRaritiesForMetadata(cards: readonly Card[], cardType: CardType, cardName: string): string[] {
  return [...new Set(cards
    .filter((card) => matchesCardType(card, cardType) && (!cardName.trim() || card.cardName === cardName))
    .flatMap((card) => card.rarities))]
    .sort();
}

export function getCardIdsForMetadata(
  cards: readonly Card[],
  cardType: CardType,
  cardName: string,
  rarity: string,
): string[] {
  if (!cardName.trim() || !rarity.trim()) return [];

  return cards
    .filter((card) => matchesCardType(card, cardType) && card.cardName === cardName && card.rarities.includes(rarity))
    .map((card) => card.id)
    .sort((first, second) => first.localeCompare(second));
}

export function hasKnownCardMetadata(cards: readonly Card[], values: CardMetadataValue): boolean {
  return cards.some((card) => card.id === values.cardId
    && matchesCardType(card, values.cardType)
    && card.cardName === values.cardName
    && card.rarities.includes(values.rarity));
}
