import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import type { ListingEvent } from './domain.js';
import {
  matchesSubscribedSeller,
  readSellerSubscriptions,
} from './sellerSubscriptions.js';

const followedAt = Timestamp.fromDate(new Date('2026-08-25T02:00:00.000Z'));

function event(overrides: Partial<ListingEvent> = {}): ListingEvent {
  return {
    id: 'listing-1', listingId: 'listing-1', sellerId: 'seller-1',
    cardType: 'character', cardName: '江戶川柯南', cardId: '0001', rarity: 'SR',
    listingPrice: 100, remainingQuantity: 1,
    createdAt: followedAt, capturedAt: followedAt, capturedSequence: 1,
    discordStatus: 'disabled', attempts: 0, ...overrides,
  };
}

describe('readSellerSubscriptions', () => {
  it('accepts exact, unique entries in deterministic seller-ID order', () => {
    const value = [
      { sellerId: 'seller-1', followedAt },
      { sellerId: 'seller-2', followedAt: Timestamp.fromMillis(followedAt.toMillis() + 1) },
    ];

    expect(readSellerSubscriptions(value)).toStrictEqual(value);
    expect(readSellerSubscriptions([])).toStrictEqual([]);
  });

  it.each([
    ['non-list input', 'seller-1'],
    ['too many entries', Array.from({ length: 101 }, (_, index) => ({
      sellerId: `seller-${String(index).padStart(3, '0')}`, followedAt,
    }))],
    ['non-object entry', [null]],
    ['missing field', [{ sellerId: 'seller-1' }]],
    ['extra field', [{ sellerId: 'seller-1', followedAt, displayName: 'Seller' }]],
    ['non-string ID', [{ sellerId: 1, followedAt }]],
    ['blank ID', [{ sellerId: '', followedAt }]],
    ['padded ID', [{ sellerId: ' seller-1 ', followedAt }]],
    ['oversized ID', [{ sellerId: 'S'.repeat(129), followedAt }]],
    ['non-Timestamp date', [{ sellerId: 'seller-1', followedAt: new Date() }]],
    ['duplicate ID', [
      { sellerId: 'seller-1', followedAt }, { sellerId: 'seller-1', followedAt },
    ]],
    ['unsorted IDs', [
      { sellerId: 'seller-2', followedAt }, { sellerId: 'seller-1', followedAt },
    ]],
  ])('rejects %s', (_label, value) => {
    expect(readSellerSubscriptions(value)).toBeNull();
  });
});

describe('matchesSubscribedSeller', () => {
  const subscriptions = [{ sellerId: 'seller-1', followedAt }];

  it('matches the exact seller at and after the follow timestamp', () => {
    expect(matchesSubscribedSeller(subscriptions, event())).toBe(true);
    expect(matchesSubscribedSeller(subscriptions, event({
      capturedAt: Timestamp.fromMillis(followedAt.toMillis() + 1),
    }))).toBe(true);
  });

  it('does not match before follow, another seller, or a legacy event', () => {
    expect(matchesSubscribedSeller(subscriptions, event({
      capturedAt: Timestamp.fromMillis(followedAt.toMillis() - 1),
    }))).toBe(false);
    expect(matchesSubscribedSeller(subscriptions, event({ sellerId: 'seller-2' }))).toBe(false);
    expect(matchesSubscribedSeller(subscriptions, event({ sellerId: undefined }))).toBe(false);
  });
});
