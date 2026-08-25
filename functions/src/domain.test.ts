import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { toListingEvent, type ListingSnapshot } from './domain.js';

const listing: ListingSnapshot = {
  cardId: 'CT-P01-001',
  characterName: ' 諸伏景光 ',
  rarity: 'SR',
  listingPrice: 120,
  remainingQuantity: 2,
  status: 'active',
  createdAt: new Date('2026-08-25T01:00:00.000Z'),
};

const expectedEvent = {
  id: 'listing-1',
  listingId: 'listing-1',
  characterKey: '諸伏景光',
  characterName: '諸伏景光',
  rarity: 'SR',
  cardId: 'CT-P01-001',
  listingPrice: 120,
  remainingQuantity: 2,
  createdAt: Timestamp.fromDate(new Date('2026-08-25T01:00:00.000Z')),
  discordStatus: 'pending',
  attempts: 0,
};

describe('toListingEvent', () => {
  it('creates an event snapshot from a complete active listing', () => {
    expect(toListingEvent('listing-1', listing)).toStrictEqual(expectedEvent);
  });

  it('rejects a listing without character metadata', () => {
    expect(() => toListingEvent('listing-1', { ...listing, characterName: undefined }))
      .toThrow('Listing event requires character metadata.');
  });

  it('rejects a listing without rarity metadata', () => {
    expect(() => toListingEvent('listing-1', { ...listing, rarity: undefined }))
      .toThrow('Listing event requires character metadata.');
  });

  it('rejects a listing that is not active', () => {
    expect(() => toListingEvent('listing-1', { ...listing, status: 'sold_out' }))
      .toThrow('Listing event requires an active listing.');
  });

  it('does not copy private seller or recipient data into the event', () => {
    const privateListing = {
      ...listing,
      sellerId: 'seller-1',
      contactValue: 'private-contact',
      email: 'buyer@example.com',
    };

    const event = toListingEvent('listing-1', privateListing);

    expect(event).toStrictEqual(expectedEvent);
    expect(event).not.toHaveProperty('sellerId');
    expect(event).not.toHaveProperty('contactValue');
    expect(event).not.toHaveProperty('email');
  });
});
