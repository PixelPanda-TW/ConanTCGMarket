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

  it('filters by a selected character name and four-digit card ID independently', () => {
    const listings = [
      { id: 'sonoko', cardId: '1096', characterName: '鈴木園子', rarity: 'SR', hasSleeve: false, supportsMyShip: true },
      { id: 'conan', cardId: '0164', characterName: '江戶川柯南', rarity: 'R', hasSleeve: false, supportsMyShip: true },
    ];

    expect(filterListings(listings, { hasSleeve: false, supportsMyShip: false, characterName: '鈴木園子' })).toEqual([listings[0]]);
  });
});
