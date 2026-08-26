import { isCardType, type CardType } from '../../domain/cardType';
import type { Card, Listing } from '../../domain/models';

export function resolveListingCard(cardId: string, cardMaster: readonly Card[], fallbackCards: readonly Card[]): Card | null {
  return cardMaster.find((card) => card.cardId === cardId) ?? fallbackCards.find((card) => card.cardId === cardId) ?? null;
}

export interface MarketplaceListingMetadata {
  cardType?: CardType;
  cardName: string;
  rarity: string;
  cardId: string;
}

export function resolveMarketplaceListingMetadata(
  listing: Listing,
  cardMaster: readonly Card[],
  fallbackCards: readonly Card[],
): MarketplaceListingMetadata {
  if (isCardType(listing.cardType) && listing.cardName?.trim()) {
    return {
      cardType: listing.cardType,
      cardName: listing.cardName,
      rarity: listing.rarity ?? '未提供稀有度',
      cardId: listing.cardId,
    };
  }

  if (listing.characterName?.trim()) {
    return {
      cardType: 'character',
      cardName: listing.characterName,
      rarity: listing.rarity ?? '未提供稀有度',
      cardId: listing.cardId,
    };
  }

  const card = resolveListingCard(listing.cardId, cardMaster, fallbackCards);
  if (card) {
    return {
      cardType: card.cardType,
      cardName: card.cardName,
      rarity: listing.rarity ?? card.rarities[0] ?? '未提供稀有度',
      cardId: listing.cardId,
    };
  }

  return {
    cardType: undefined,
    cardName: '未提供卡片名稱',
    rarity: listing.rarity ?? '未提供稀有度',
    cardId: listing.cardId,
  };
}
