import type { Card } from './models';

export interface CardMetadataValue {
  cardId: string;
  characterName: string;
  rarity: string;
}

export function cardRarities(card: Card): readonly string[] {
  return card.rarities ?? (card.rarity ? [card.rarity] : []);
}

export function getCharacterNameSuggestions(cards: readonly Card[], query: string): string[] {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return [];

  return [...new Set(cards
    .map((card) => card.characterName)
    .filter((name): name is string => Boolean(name?.startsWith(normalizedQuery))))];
}

export function getRaritiesForCharacter(cards: readonly Card[], characterName: string): string[] {
  if (!characterName.trim()) return [];

  return [...new Set(cards
    .filter((card) => card.characterName === characterName)
    .flatMap(cardRarities))]
    .sort();
}

export function getCardIdsForMetadata(cards: readonly Card[], characterName: string, rarity: string): string[] {
  if (!characterName.trim() || !rarity.trim()) return [];

  return cards
    .filter((card) => card.characterName === characterName && cardRarities(card).includes(rarity))
    .map((card) => card.id)
    .sort((first, second) => first.localeCompare(second));
}

export function hasKnownCardMetadata(cards: readonly Card[], values: CardMetadataValue): boolean {
  return cards.some((card) => card.id === values.cardId
    && card.characterName === values.characterName
    && cardRarities(card).includes(values.rarity));
}
