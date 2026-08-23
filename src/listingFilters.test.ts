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

  it('filters by selected card and rarity when present', () => {
    const listings = [
      { id: 'cp', cardId: 'BT-003', rarity: 'CP', hasSleeve: false, supportsMyShip: true },
      { id: 'sr', cardId: 'BT-004', rarity: 'SR', hasSleeve: false, supportsMyShip: true },
    ];

    expect(filterListings(listings, { hasSleeve: false, supportsMyShip: false, cardId: 'BT-003', rarity: 'CP' })).toEqual([listings[0]]);
  });
});
