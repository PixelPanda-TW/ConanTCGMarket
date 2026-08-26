import type { CardType } from './cardType';
import type { Card } from './models';

export interface CardMetadataValue {
  cardType: CardType;
  cardName: string;
  rarity: string;
  cardId: string;
}

export interface LegacyCardMetadataValue {
  characterName: string;
  rarity: string;
  cardId: string;
}

/** Controls whether rarity selection is constrained to an exact card name. */
export type CardMetadataRarityMode = 'sell' | 'marketplace';

interface LegacyCard {
  id: string;
  characterName: string;
  rarities?: readonly string[];
  rarity?: string;
}

type MetadataCard = Card | LegacyCard;

function isLegacyCard(card: MetadataCard): card is LegacyCard {
  return !('cardType' in card);
}

function cardRarities(card: MetadataCard): readonly string[] {
  if (isLegacyCard(card)) {
    return card.rarities ?? (card.rarity ? [card.rarity] : []);
  }

  return card.rarities;
}

function cardNameOf(card: MetadataCard): string {
  return isLegacyCard(card) ? card.characterName : card.cardName;
}

function matchesCardType(card: MetadataCard, cardType: CardType): boolean {
  return isLegacyCard(card) ? cardType === 'character' : card.cardType === cardType;
}

export function getCardNameSuggestions(cards: readonly MetadataCard[], cardType: CardType, query: string): string[] {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return [];

  return [...new Set(cards
    .filter((card) => matchesCardType(card, cardType))
    .map(cardNameOf)
    .filter((name) => name.startsWith(normalizedQuery)))];
}

export function hasKnownCardName(cards: readonly MetadataCard[], cardType: CardType, cardName: string): boolean {
  return Boolean(cardName.trim()) && cards.some((card) => matchesCardType(card, cardType) && cardNameOf(card) === cardName);
}

export function getRaritiesForMetadata(
  cards: readonly MetadataCard[],
  cardType: CardType,
  cardName: string,
  mode: CardMetadataRarityMode = 'sell',
): string[] {
  const shouldUseExactName = mode === 'sell' || hasKnownCardName(cards, cardType, cardName);

  return [...new Set(cards
    .filter((card) => matchesCardType(card, cardType) && (!shouldUseExactName || cardNameOf(card) === cardName))
    .flatMap(cardRarities))]
    .sort();
}

export function getCardIdsForMetadata(
  cards: readonly MetadataCard[],
  cardType: CardType,
  cardName: string,
  rarity: string,
): string[];
export function getCardIdsForMetadata(
  cards: readonly MetadataCard[],
  characterName: string,
  rarity: string,
): string[];
export function getCardIdsForMetadata(
  cards: readonly MetadataCard[],
  cardTypeOrCharacterName: CardType | string,
  cardNameOrRarity: string,
  maybeRarity?: string,
): string[] {
  const isLegacyCall = maybeRarity === undefined;
  const cardType = isLegacyCall ? 'character' : cardTypeOrCharacterName as CardType;
  const cardName = isLegacyCall ? cardTypeOrCharacterName : cardNameOrRarity;
  const rarity = isLegacyCall ? cardNameOrRarity : maybeRarity;
  if (!cardName.trim() || !rarity.trim()) return [];

  return cards
    .filter((card) => matchesCardType(card, cardType) && cardNameOf(card) === cardName && cardRarities(card).includes(rarity))
    .map((card) => card.id)
    .sort((first, second) => first.localeCompare(second));
}

export function hasKnownCardMetadata(
  cards: readonly MetadataCard[],
  values: CardMetadataValue | LegacyCardMetadataValue,
): boolean {
  const cardType = 'cardType' in values ? values.cardType : 'character';
  const knownCardName = 'cardName' in values ? values.cardName : values.characterName;

  return cards.some((card) => card.id === values.cardId
    && matchesCardType(card, cardType)
    && cardNameOf(card) === knownCardName
    && cardRarities(card).includes(values.rarity));
}

export function getCharacterNameSuggestions(cards: readonly MetadataCard[], query: string): string[] {
  return getCardNameSuggestions(cards, 'character', query);
}

export function getRaritiesForCharacter(cards: readonly MetadataCard[], characterName: string): string[] {
  return getRaritiesForMetadata(cards, 'character', characterName);
}
