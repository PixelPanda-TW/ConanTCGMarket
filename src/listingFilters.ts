import type { CardType } from './domain/cardType';
import {
  normalizeCardIdQuery,
  validateCardIdQuery as validateVisibleCardIdQuery,
} from './domain/cardId';

export { validateCardIdQuery } from './domain/cardId';

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

export function filterListings<TListing extends FilterableListing>(
  listings: TListing[],
  filters: ListingFilters,
) {
  const cardIdQuery = normalizeCardIdQuery(filters.cardIdQuery ?? '');
  const cardIdQueryError = validateVisibleCardIdQuery(cardIdQuery);

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
