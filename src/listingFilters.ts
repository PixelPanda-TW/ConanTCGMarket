export interface FilterableListing {
  hasSleeve: boolean;
  supportsMyShip: boolean;
}

export interface ListingFilters {
  hasSleeve: boolean;
  supportsMyShip: boolean;
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

    return true;
  });
}
