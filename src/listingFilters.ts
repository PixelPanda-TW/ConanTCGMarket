export interface FilterableListing {
  hasSleeve: boolean;
  supportsMyShip: boolean;
  cardId?: string;
  rarity?: string;
}

export interface ListingFilters {
  hasSleeve: boolean;
  supportsMyShip: boolean;
  cardId?: string;
  rarity?: string;
}

export function filterListings<TListing extends FilterableListing>(
  listings: TListing[],
  filters: ListingFilters,
) {
  return listings.filter((listing) => {
    if (filters.hasSleeve && !listing.hasSleeve) {
      return false;
    }

    if (filters.supportsMyShip && !listing.supportsMyShip) {
      return false;
    }
    if (filters.cardId && listing.cardId !== filters.cardId) return false;
    if (filters.rarity && listing.rarity !== filters.rarity) return false;

    return true;
  });
}
