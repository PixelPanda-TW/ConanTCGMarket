import { describe, expect, it } from 'vitest';
import { filterListings } from './listingFilters';

describe('filterListings', () => {
  it('removes listings without myship support when the myship filter is enabled', () => {
    const listings = [
      { id: 'with-myship', hasSleeve: false, supportsMyShip: true },
      { id: 'without-myship', hasSleeve: true, supportsMyShip: false },
    ];

    expect(filterListings(listings, { hasSleeve: false, supportsMyShip: true })).toEqual([
      { id: 'with-myship', hasSleeve: false, supportsMyShip: true },
    ]);
  });
});
