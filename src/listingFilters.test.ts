import { describe, expect, it } from 'vitest';
import { filterListings, validateCardIdQuery } from './listingFilters';

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

  it('filters generic metadata with a leading-zero ID prefix or exact four-digit ID', () => {
    const listing0501 = {
      id: '0501', cardId: '0501', cardType: 'event' as const, cardName: '追跡開始', rarity: 'C', hasSleeve: false, supportsMyShip: true,
    };
    const listing0590 = {
      id: '0590', cardId: '0590', cardType: 'character' as const, cardName: '諸伏景光', rarity: 'R', hasSleeve: false, supportsMyShip: true,
    };
    const base = (overrides = {}) => ({ hasSleeve: false, supportsMyShip: false, ...overrides });

    expect(filterListings([listing0501, listing0590], base({ cardIdQuery: '05' }))).toEqual([listing0501, listing0590]);
    expect(filterListings([listing0501, listing0590], base({ cardIdQuery: '0501' }))).toEqual([listing0501]);
    expect(filterListings([listing0501, listing0590], base({ cardType: 'event', cardIdQuery: '05', supportsMyShip: true }))).toEqual([listing0501]);
  });

  it('rejects non-digits and more than four digits without matching', () => {
    const listing = { id: '0501', cardId: '0501', hasSleeve: false, supportsMyShip: true };

    expect(validateCardIdQuery(' 05 ')).toBeUndefined();
    expect(validateCardIdQuery('05a')).toBe('卡片 ID 只能輸入最多 4 位數字。');
    expect(validateCardIdQuery('05012')).toBe('卡片 ID 只能輸入最多 4 位數字。');
    expect(filterListings([listing], { hasSleeve: false, supportsMyShip: false, cardIdQuery: '05a' })).toEqual([]);
  });
});
