import { normalizeCardId } from './cardId';
import { isCardType, type CardType } from './cardType';
import type { Card, Listing } from './models';

export interface ResolvedListingMetadata {
  cardType?: CardType;
  cardName: string;
  rarity: string;
  cardId: string;
  resolution: 'snapshot' | 'legacy-character' | 'card-master' | 'ambiguous' | 'missing';
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function resolvedCardId(cardId: string, card?: Card): string {
  return hasText(cardId) ? normalizeCardId(cardId) : card?.cardId ?? '未提供卡片 ID';
}

function resolvedRarity(rarity: string | undefined, card?: Card): string {
  return hasText(rarity) ? rarity : card?.rarities.find(hasText) ?? '未提供稀有度';
}

function fromSnapshot(listing: Listing): ResolvedListingMetadata {
  return {
    cardType: listing.cardType,
    cardName: listing.cardName as string,
    rarity: resolvedRarity(listing.rarity),
    cardId: resolvedCardId(listing.cardId),
    resolution: 'snapshot',
  };
}

function fromLegacyCharacter(listing: Listing): ResolvedListingMetadata {
  return {
    cardType: 'character',
    cardName: listing.characterName as string,
    rarity: resolvedRarity(listing.rarity),
    cardId: resolvedCardId(listing.cardId),
    resolution: 'legacy-character',
  };
}

function fromCardMaster(listing: Listing, card: Card): ResolvedListingMetadata {
  return {
    cardType: card.cardType,
    cardName: card.cardName,
    rarity: resolvedRarity(listing.rarity, card),
    cardId: resolvedCardId(listing.cardId, card),
    resolution: 'card-master',
  };
}

function ambiguousMetadata(cardId: string, rarity?: string): ResolvedListingMetadata {
  return {
    cardType: undefined,
    cardName: '卡片資料不明確',
    rarity: resolvedRarity(rarity),
    cardId: resolvedCardId(cardId),
    resolution: 'ambiguous',
  };
}

function missingMetadata(cardId: string, rarity?: string): ResolvedListingMetadata {
  return {
    cardType: undefined,
    cardName: '未提供卡片名稱',
    rarity: resolvedRarity(rarity),
    cardId: resolvedCardId(cardId),
    resolution: 'missing',
  };
}

export function findCardsByVisibleId(cards: readonly Card[], cardId: string): Card[] {
  const normalized = normalizeCardId(cardId);
  return cards.filter((card) => card.cardId === normalized);
}

export function resolveListingMetadata(listing: Listing, cards: readonly Card[]): ResolvedListingMetadata {
  if (isCardType(listing.cardType) && hasText(listing.cardName)) return fromSnapshot(listing);
  if (hasText(listing.characterName)) return fromLegacyCharacter(listing);

  const candidates = findCardsByVisibleId(cards, listing.cardId);
  if (candidates.length === 1) return fromCardMaster(listing, candidates[0]);
  if (candidates.length > 1) return ambiguousMetadata(listing.cardId, listing.rarity);
  return missingMetadata(listing.cardId, listing.rarity);
}
