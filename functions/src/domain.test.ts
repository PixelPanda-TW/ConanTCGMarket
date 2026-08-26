import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { toCharacterListingEvent, toListingEvent, type ListingSnapshot } from './domain.js';

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

  it.each([
    ['non-object snapshot', null],
    ['non-string card ID', { ...listing, cardId: 1096 }],
    ['oversized card ID', { ...listing, cardId: 'C'.repeat(101) }],
    ['non-string character name', { ...listing, characterName: 42 }],
    ['oversized character name', { ...listing, characterName: '角'.repeat(101) }],
    ['non-string rarity', { ...listing, rarity: false }],
    ['oversized rarity', { ...listing, rarity: 'R'.repeat(51) }],
    ['string price', { ...listing, listingPrice: '120' }],
    ['non-finite price', { ...listing, listingPrice: Number.POSITIVE_INFINITY }],
    ['non-positive price', { ...listing, listingPrice: 0 }],
    ['oversized price', { ...listing, listingPrice: 10_000_001 }],
    ['fractional quantity', { ...listing, remainingQuantity: 1.5 }],
    ['non-positive quantity', { ...listing, remainingQuantity: 0 }],
    ['oversized quantity', { ...listing, remainingQuantity: 10_001 }],
    ['invalid creation date', { ...listing, createdAt: new Date('invalid') }],
    ['non-date creation timestamp', { ...listing, createdAt: '2026-08-25' }],
  ])('rejects a client-writable %s before creating an event', (_label, snapshot) => {
    expect(() => toListingEvent('listing-1', snapshot as never))
      .toThrow(/Invalid Listing snapshot/);
  });

  it.each([
    ['empty Listing ID', ''],
    ['oversized Listing ID', 'L'.repeat(201)],
  ])('rejects an %s before creating an event', (_label, listingId) => {
    expect(() => toListingEvent(listingId, listing))
      .toThrow(/Invalid Listing snapshot/);
  });
});

describe('toCharacterListingEvent', () => {
  it('returns null for an explicit non-character card before building an event', () => {
    expect(toCharacterListingEvent('event-1', {
      ...listing,
      cardType: 'event',
      cardName: '追跡開始',
      characterName: undefined,
    })).toBeNull();
  });

  it('uses legacy character metadata when card type is missing', () => {
    expect(toCharacterListingEvent('legacy-1', listing)).toMatchObject({
      characterName: '諸伏景光',
      characterKey: '諸伏景光',
    });
  });

  it('requires explicit character Listing metadata to match the card name', () => {
    expect(() => toCharacterListingEvent('character-1', {
      ...listing,
      cardType: 'character',
      cardName: '安室透',
    })).toThrow('characterName must match cardName.');
  });
});
