import type { CardType } from './domain/cardType';

export interface FilterableListing {
  hasSleeve: boolean;
  supportsMyShip: boolean;
  cardId?: string;
  cardType?: CardType;
  cardName?: string;
  characterName?: string;
  rarity?: string;
}

export interface ListingFilters {
  hasSleeve: boolean;
  supportsMyShip: boolean;
  cardType?: CardType;
  cardName?: string;
  cardIdQuery?: string;
  /** @deprecated Use cardIdQuery for independent string-preserving search. */
  cardId?: string;
  /** @deprecated Use cardName. */
  characterName?: string;
  rarity?: string;
}

export function validateCardIdQuery(value: string | undefined): string | undefined {
  const query = value?.trim() ?? '';
  return /^\d{0,4}$/.test(query) ? undefined : '卡片 ID 只能輸入最多 4 位數字。';
}

export function filterListings<TListing extends FilterableListing>(
  listings: TListing[],
  filters: ListingFilters,
) {
  const cardIdQuery = filters.cardIdQuery?.trim() ?? '';
  const cardIdQueryError = validateCardIdQuery(filters.cardIdQuery);

  return listings.filter((listing) => {
    if (cardIdQueryError) return false;
    if (filters.hasSleeve && !listing.hasSleeve) {
      return false;
    }

    if (filters.supportsMyShip && !listing.supportsMyShip) {
      return false;
    }
    if (filters.cardId && listing.cardId !== filters.cardId) return false;
    if (cardIdQuery && (!listing.cardId || (cardIdQuery.length === 4
      ? listing.cardId !== cardIdQuery
      : !listing.cardId.startsWith(cardIdQuery)))) return false;
    if (filters.cardType && listing.cardType !== filters.cardType) return false;
    if (filters.cardName && listing.cardName !== filters.cardName) return false;
    if (filters.characterName && listing.characterName !== filters.characterName) return false;
    if (filters.rarity && listing.rarity !== filters.rarity) return false;

    return true;
  });
}
