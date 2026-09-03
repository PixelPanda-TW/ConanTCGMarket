import { describe, expect, it } from 'vitest';
import {
  validateCard,
  validateListing,
  validateNotificationSubscription,
  validateSale,
  validateSellerProfile,
  validateSellerProfileStructure,
  type Card,
  type Listing,
  type NotificationSubscription,
  type Sale,
  type SellerProfile,
} from './index';
import { CARD_TYPES, cardTypeLabel, isCardType } from '../cardType';

describe('domain model validation', () => {
  it('accepts notification subscriptions for complete raw Card Master names', () => {
    const subscription: NotificationSubscription = {
      uid: 'buyer-1',
      cardNames: ['江戶川柯南', '洗牌情緣'],
      emailDailyEnabled: true,
      updatedAt: new Date('2026-08-27T00:00:00.000Z'),
    };

    expect(() => validateNotificationSubscription(subscription)).not.toThrow();
    expect(() => validateNotificationSubscription({
      ...subscription,
      cardNames: [],
    })).not.toThrow();
  });

  it('rejects notification subscriptions with malformed card names', () => {
    expect(() => validateNotificationSubscription({
      uid: 'buyer-1',
      cardNames: [''],
      emailDailyEnabled: true,
      updatedAt: new Date('2026-08-27T00:00:00.000Z'),
    })).toThrow();
    expect(() => validateNotificationSubscription({
      uid: 'buyer-1',
      cardNames: ['江戶川柯南', '江戶川柯南'],
      emailDailyEnabled: true,
      updatedAt: new Date('2026-08-27T00:00:00.000Z'),
    })).toThrow('unique card names');
    expect(() => validateNotificationSubscription({
      uid: 'buyer-1',
      cardNames: [' 江戶川柯南'],
      emailDailyEnabled: true,
      updatedAt: new Date('2026-08-27T00:00:00.000Z'),
    })).toThrow('trimmed card names');
    expect(() => validateNotificationSubscription({
      uid: 'buyer-1',
      cardNames: [123],
      emailDailyEnabled: true,
      updatedAt: new Date('2026-08-27T00:00:00.000Z'),
    })).toThrow();
    expect(() => validateNotificationSubscription({
      uid: 'buyer-1',
      cardNames: ['角'.repeat(101)],
      emailDailyEnabled: true,
      updatedAt: new Date('2026-08-27T00:00:00.000Z'),
    })).toThrow(/at most 100 characters/);
    expect(() => validateNotificationSubscription({
      uid: 'buyer-1',
      cardNames: Array.from({ length: 101 }, (_, index) => `角色-${index}`),
      emailDailyEnabled: true,
      updatedAt: new Date('2026-08-27T00:00:00.000Z'),
    })).toThrow(/at most 100/);
    expect(() => validateNotificationSubscription({
      uid: 'buyer-1',
      emailDailyEnabled: true,
      updatedAt: new Date('2026-08-27T00:00:00.000Z'),
    })).toThrow('cardNames');
    expect(() => validateNotificationSubscription({
      uid: 'buyer-1',
      characterKeys: ['江戶川柯南'],
      emailDailyEnabled: true,
      updatedAt: new Date('2026-08-27T00:00:00.000Z'),
    })).toThrow();
  });

  it('rejects a non-boolean daily email preference', () => {
    expect(() => validateNotificationSubscription({
      uid: 'buyer-1',
      cardNames: ['江戶川柯南'],
      emailDailyEnabled: 'true',
      updatedAt: new Date('2026-08-27T00:00:00.000Z'),
    })).toThrow('boolean emailDailyEnabled');
  });

  it('accepts normalized promotional Card Master metadata with a stable key', () => {
    expect(() => validateCard({
      key: 'card_hash', cardId: 'P001', cardType: 'event', cardName: '追跡開始', rarities: ['C'],
    } as Card)).not.toThrow();
  });

  it('keeps legacy aliases out of the normalized Card Master shape', () => {
    const card: Card = {
      key: 'card_hash', cardId: 'P001', cardType: 'event', cardName: '追跡開始', rarities: ['C'],
      // @ts-expect-error Card Master records have no legacy character alias.
      characterName: '追跡開始',
    };

    expect(card.cardName).toBe('追跡開始');
  });

  it.each(['P01', 'B0982', 'p001'])('rejects unnormalized or incomplete Card Master card ID %s', (cardId) => {
    expect(() => validateCard({
      key: 'card_hash', cardId, cardType: 'character', cardName: '鈴木園子', rarities: ['SR'],
    } as Card)).toThrow();
  });

  it('rejects cards with an unsupported card type', () => {
    expect(() => validateCard({
      key: 'card_hash', cardId: '1100', cardType: 'unknown', cardName: '追跡開始', rarities: ['C'],
    } as never)).toThrow('Card requires a supported cardType.');
  });

  it('requires each card to have a card name', () => {
    const card: Card = {
      key: 'card_hash',
      cardId: '0001',
      cardType: 'character',
      rarities: ['CP'],
    } as unknown as Card;

    expect(() => validateCard(card)).toThrow('Card requires cardName.');
  });

  it('exposes the supported card types with their UI labels', () => {
    expect(CARD_TYPES).toEqual(['character', 'event', 'case', 'partner']);
    expect(isCardType('event')).toBe(true);
    expect(isCardType('unknown')).toBe(false);
    expect(cardTypeLabel('case')).toBe('Case 卡（情境卡）');
  });

  it('accepts a valid active listing with a normalized promotional card ID snapshot', () => {
    const listing: Listing = {
      id: 'listing-1',
      sellerId: 'seller-1',
      cardId: 'P001',
      cardType: 'character',
      cardName: '諸伏景光',
      characterName: '諸伏景光',
      rarity: 'CP',
      imageUrls: ['https://example.com/card.jpg'],
      listingPrice: 500,
      originalQuantity: 5,
      remainingQuantity: 3,
      hasSleeve: true,
      supportsMyShip: true,
      status: 'active',
      createdAt: new Date('2026-08-17T00:00:00.000Z'),
      updatedAt: new Date('2026-08-17T00:00:00.000Z'),
    };

    expect(() => validateListing(listing)).not.toThrow();
  });

  it('accepts an event listing without a character snapshot', () => {
    const eventListing: Listing = {
      id: 'listing-event', sellerId: 'seller-1', cardId: '1100', cardType: 'event', cardName: '追跡開始', rarity: 'C',
      imageUrls: ['https://example.com/card.jpg'], listingPrice: 500, originalQuantity: 1, remainingQuantity: 1,
      hasSleeve: false, supportsMyShip: false, status: 'active',
      createdAt: new Date('2026-08-17T00:00:00.000Z'), updatedAt: new Date('2026-08-17T00:00:00.000Z'),
    };

    expect(() => validateListing(eventListing)).not.toThrow();
    expect(eventListing.characterName).toBeUndefined();
    expect(() => validateListing({ ...eventListing, characterName: '偽角色' }))
      .toThrow('Non-character Listing cannot contain characterName.');
  });

  it.each(['P01', 'B0982', 'p001'])('rejects unnormalized or incomplete listing card ID %s', (cardId) => {
    const listing: Listing = {
      id: 'listing-1', sellerId: 'seller-1', cardId, cardType: 'character', cardName: '諸伏景光', characterName: '諸伏景光', rarity: 'CP',
      imageUrls: ['https://example.com/card.jpg'], listingPrice: 500, originalQuantity: 1, remainingQuantity: 1,
      hasSleeve: false, supportsMyShip: false, status: 'active',
      createdAt: new Date('2026-08-17T00:00:00.000Z'), updatedAt: new Date('2026-08-17T00:00:00.000Z'),
    };

    expect(() => validateListing(listing)).toThrow();
  });

  it('requires generic card metadata and rarity snapshots on a listing', () => {
    const listing = {
      id: 'listing-1', sellerId: 'seller-1', cardId: '1096', imageUrls: ['https://example.com/card.jpg'], listingPrice: 500,
      originalQuantity: 5, remainingQuantity: 5, hasSleeve: false, supportsMyShip: false, status: 'active',
      createdAt: new Date('2026-08-17T00:00:00.000Z'), updatedAt: new Date('2026-08-17T00:00:00.000Z'),
    } as Listing;

    expect(() => validateListing(listing)).toThrow('Listing requires cardType, cardName, and rarity snapshots.');
  });

  it('rejects listings without photos', () => {
    const listing: Listing = {
      id: 'listing-1',
      sellerId: 'seller-1',
      cardId: '0001',
      cardType: 'character',
      cardName: '諸伏景光',
      characterName: '諸伏景光',
      rarity: 'CP',
      imageUrls: [],
      listingPrice: 500,
      originalQuantity: 5,
      remainingQuantity: 5,
      hasSleeve: true,
      supportsMyShip: true,
      status: 'active',
      createdAt: new Date('2026-08-17T00:00:00.000Z'),
      updatedAt: new Date('2026-08-17T00:00:00.000Z'),
    };

    expect(() => validateListing(listing)).toThrow('Listing requires 1 to 3 image URLs.');
  });

  it('accepts canonical seller contacts for every supported service', () => {
    const baseProfile: SellerProfile = {
      uid: 'seller-1',
      displayName: 'Seller',
      contactType: 'line',
      contactValue: '@seller',
      createdAt: new Date('2026-08-17T00:00:00.000Z'),
      updatedAt: new Date('2026-08-17T00:00:00.000Z'),
    };

    expect(() => validateSellerProfile(baseProfile)).not.toThrow();
    expect(() => validateSellerProfile({
      ...baseProfile, contactType: 'discord', contactValue: 'seller_name',
    })).not.toThrow();
    expect(() => validateSellerProfile({
      ...baseProfile, contactType: 'facebook', contactValue: 'https://www.facebook.com/seller',
    })).not.toThrow();
    expect(() => validateSellerProfile({
      ...baseProfile, contactType: 'threads', contactValue: 'https://www.threads.net/@seller',
    })).not.toThrow();
  });

  it.each([
    ['threads', '@legacy'],
    ['facebook', 'https://www.facebook.com/groups/conan'],
    ['discord', 'https://discord.gg/conan'],
    ['facebook', 'https://m.facebook.com/seller'],
  ] as const)('rejects noncanonical %s seller contact writes', (contactType, contactValue) => {
    const profile: SellerProfile = {
      uid: 'seller-1',
      displayName: 'Seller',
      contactType,
      contactValue,
      createdAt: new Date('2026-08-17T00:00:00.000Z'),
      updatedAt: new Date('2026-08-17T00:00:00.000Z'),
    };

    expect(() => validateSellerProfile(profile)).toThrow(
      'Seller profile requires a canonical contactValue for contactType.',
    );
  });

  it('keeps a non-empty legacy contact structurally readable for correction', () => {
    const profile: SellerProfile = {
      uid: 'seller-1',
      displayName: 'Seller',
      contactType: 'threads',
      contactValue: '@legacy',
      createdAt: new Date('2026-08-17T00:00:00.000Z'),
      updatedAt: new Date('2026-08-17T00:00:00.000Z'),
    };

    expect(() => validateSellerProfileStructure(profile)).not.toThrow();
  });

  it('rejects seller profiles without contact values structurally', () => {
    const profile: SellerProfile = {
      uid: 'seller-1',
      displayName: 'Seller',
      contactType: 'line',
      contactValue: '',
      createdAt: new Date('2026-08-17T00:00:00.000Z'),
      updatedAt: new Date('2026-08-17T00:00:00.000Z'),
    };

    expect(() => validateSellerProfileStructure(profile)).toThrow('Seller profile requires contactValue.');
  });

  it('rejects sale quantity above zero requirement', () => {
    const sale: Sale = {
      id: 'sale-1',
      listingId: 'listing-1',
      sellerId: 'seller-1',
      cardId: '0001',
      quantity: 0,
      listingUnitPrice: 500,
      soldUnitPrice: 450,
      soldAt: new Date('2026-08-17T00:00:00.000Z'),
    };

    expect(() => validateSale(sale)).toThrow('Sale quantity must be greater than 0.');
  });

  it('rejects non-finite listing prices and non-integer quantities', () => {
    const listing: Listing = {
      id: 'listing-1',
      sellerId: 'seller-1',
      cardId: 'CT-P01-001',
      imageUrls: ['https://example.com/card.jpg'],
      listingPrice: Number.POSITIVE_INFINITY,
      originalQuantity: 1.5,
      remainingQuantity: 1,
      hasSleeve: true,
      supportsMyShip: true,
      status: 'active',
      createdAt: new Date('2026-08-17T00:00:00.000Z'),
      updatedAt: new Date('2026-08-17T00:00:00.000Z'),
    };

    expect(() => validateListing(listing)).toThrow();
  });
});
