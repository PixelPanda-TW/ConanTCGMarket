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

describe('toListingEvent', () => {
  it('creates an event snapshot from a complete active listing', () => {
    expect(toListingEvent('listing-1', listing)).toEqual({
      id: 'listing-1',
      listingId: 'listing-1',
      characterKey: '諸伏景光',
      characterName: '諸伏景光',
      rarity: 'SR',
      cardId: 'CT-P01-001',
      listingPrice: 120,
      remainingQuantity: 2,
      createdAt: new Date('2026-08-25T01:00:00.000Z'),
      discordStatus: 'pending',
      attempts: 0,
    });
  });

  it('rejects a listing without character metadata', () => {
    expect(() => toListingEvent('listing-1', { ...listing, characterName: undefined }))
      .toThrow('Listing event requires character metadata.');
  });

  it('rejects a listing without rarity metadata', () => {
    expect(() => toListingEvent('listing-1', { ...listing, rarity: undefined }))
      .toThrow('Listing event requires character metadata.');
  });

  it('does not copy private seller or recipient data into the event', () => {
    const privateListing = {
      ...listing,
      sellerId: 'seller-1',
      contactValue: 'private-contact',
      email: 'buyer@example.com',
    };

    expect(toListingEvent('listing-1', privateListing)).not.toEqual(expect.objectContaining({
      sellerId: expect.anything(),
      contactValue: expect.anything(),
      email: expect.anything(),
    }));
  });
});
