import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import {
  readListingEvent,
  readListingEventPage,
  toListingEvent,
  type ListingSnapshot,
} from './domain.js';

const listing: ListingSnapshot = {
  sellerId: 'seller-1',
  cardType: 'character',
  cardName: ' 諸伏景光 ',
  cardId: 'P001',
  rarity: 'SR',
  listingPrice: 120,
  remainingQuantity: 2,
  status: 'active',
  createdAt: new Date('2026-08-25T01:00:00.000Z'),
};

const expectedEvent = {
  id: 'listing-1',
  listingId: 'listing-1',
  sellerId: 'seller-1',
  cardType: 'character',
  cardName: ' 諸伏景光 ',
  rarity: 'SR',
  cardId: 'P001',
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

  it.each([
    ['character', '江戶川柯南', '0001'],
    ['partner', '江戶川柯南', 'P001'],
    ['event', '追蹤開始', '1100'],
    ['case', '洗牌情緣', '0019'],
  ] as const)('creates a generic %s event', (cardType, cardName, cardId) => {
    expect(toListingEvent('listing-1', {
      sellerId: 'seller-1',
      cardType,
      cardName,
      cardId,
      rarity: 'CP',
      listingPrice: 500,
      remainingQuantity: 2,
      status: 'active',
      createdAt: new Date('2026-08-27T00:00:00.000Z'),
    }, { discordEnabled: false })).toMatchObject({
      listingId: 'listing-1',
      cardType,
      cardName,
      cardId,
      rarity: 'CP',
      discordStatus: 'disabled',
    });
  });

  it('creates a disabled Discord snapshot for email-only capture', () => {
    expect(toListingEvent('listing-1', listing, { discordEnabled: false })).toStrictEqual({
      ...expectedEvent,
      discordStatus: 'disabled',
    });
  });

  it.each([
    ['width', 'ＣＯＮＡＮ'],
    ['Unicode composition', 'cafe\u0301'],
    ['internal whitespace', '江戶川  柯南'],
    ['outer whitespace', ' 江戶川柯南 '],
  ])('preserves a raw %s-different Listing card name', (_label, cardName) => {
    expect(toListingEvent('listing-raw', {
      ...listing,
      cardName,
    }).cardName).toBe(cardName);
  });

  it('rejects a listing without a card type', () => {
    expect(() => toListingEvent('listing-1', { ...listing, cardType: undefined }))
      .toThrow('cardType must be character, event, case, or partner.');
  });

  it('rejects a listing with an unknown card type', () => {
    expect(() => toListingEvent('listing-1', { ...listing, cardType: 'promo' }))
      .toThrow('cardType must be character, event, case, or partner.');
  });

  it('rejects a listing without card metadata', () => {
    expect(() => toListingEvent('listing-1', { ...listing, cardName: undefined }))
      .toThrow(/cardName/);
  });

  it.each([
    ['partner', '江戶川柯南', 'P001'],
    ['event', '追蹤開始', '1100'],
    ['case', '洗牌情緣', '0019'],
  ] as const)('does not require character-specific metadata for %s Listings', (
    cardType,
    cardName,
    cardId,
  ) => {
    expect(toListingEvent('listing-1', {
      sellerId: 'seller-1',
      cardType,
      cardName,
      cardId,
      rarity: 'CP',
      listingPrice: 500,
      remainingQuantity: 2,
      status: 'active',
      createdAt: new Date('2026-08-27T00:00:00.000Z'),
    })).toMatchObject({ cardType, cardName, cardId });
  });

  it('rejects a listing that is not active', () => {
    expect(() => toListingEvent('listing-1', { ...listing, status: 'sold_out' }))
      .toThrow('Listing event requires an active listing.');
  });

  it('copies only the seller identity needed for matching, not private contact data', () => {
    const privateListing = {
      ...listing,
      sellerId: 'seller-1',
      contactValue: 'private-contact',
      email: 'buyer@example.com',
    };

    const event = toListingEvent('listing-1', privateListing);

    expect(event).toStrictEqual(expectedEvent);
    expect(event.sellerId).toBe('seller-1');
    expect(event).not.toHaveProperty('contactValue');
    expect(event).not.toHaveProperty('email');
  });

  it.each([
    ['non-object snapshot', null],
    ['missing seller ID', { ...listing, sellerId: undefined }],
    ['non-string seller ID', { ...listing, sellerId: 42 }],
    ['blank seller ID', { ...listing, sellerId: ' \t ' }],
    ['padded seller ID', { ...listing, sellerId: ' seller-1 ' }],
    ['oversized seller ID', { ...listing, sellerId: 'S'.repeat(129) }],
    ['non-string card ID', { ...listing, cardId: 1096 }],
    ['oversized card ID', { ...listing, cardId: 'C'.repeat(101) }],
    ['non-string card name', { ...listing, cardName: 42 }],
    ['blank card name', { ...listing, cardName: ' \t\n ' }],
    ['oversized card name', { ...listing, cardName: '角'.repeat(101) }],
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

describe('stored Listing event decoding', () => {
  const storedEvent = {
    ...expectedEvent,
    cardName: ' ＣＯＮＡＮ  cafe\u0301 ',
    capturedAt: Timestamp.fromDate(new Date('2026-08-25T01:01:00.000Z')),
    capturedSequence: 3,
  };

  it('runtime-decodes a complete generic event without rewriting its raw card name', () => {
    expect(readListingEvent(storedEvent)).toStrictEqual(storedEvent);
  });

  it('continues to decode a legacy event that has no seller identity', () => {
    const { sellerId: _sellerId, ...legacyEvent } = storedEvent;

    expect(readListingEvent(legacyEvent)).toStrictEqual(legacyEvent);
  });

  it.each([
    ['non-string seller ID', { ...storedEvent, sellerId: 42 }],
    ['blank seller ID', { ...storedEvent, sellerId: '' }],
    ['padded seller ID', { ...storedEvent, sellerId: ' seller-1 ' }],
    ['oversized seller ID', { ...storedEvent, sellerId: 'S'.repeat(129) }],
  ])('skips an event with a present but %s', (_label, value) => {
    expect(readListingEvent(value)).toBeNull();
  });

  it.each([
    ['legacy character event', {
      ...storedEvent,
      cardName: undefined,
      characterKey: 'conan',
      characterName: '江戶川柯南',
    }],
    ['malformed generic event', { ...storedEvent, remainingQuantity: '2' }],
  ])('skips a %s', (_label, value) => {
    expect(readListingEvent(value)).toBeNull();
  });

  it('keeps a raw pagination cursor when a full event page contains only invalid history', () => {
    const invalidPage = readListingEventPage([
      { capturedSequence: 1, characterName: '舊角色一' },
      { capturedSequence: 2, characterName: '舊角色二' },
    ], 0, 2);
    const validPage = readListingEventPage([
      storedEvent,
    ], invalidPage.nextAfterSequence, 2);

    expect(invalidPage).toStrictEqual({
      events: [],
      nextAfterSequence: 2,
      hasMore: true,
    });
    expect(validPage).toStrictEqual({
      events: [storedEvent],
      nextAfterSequence: 3,
      hasMore: false,
    });
  });
});
