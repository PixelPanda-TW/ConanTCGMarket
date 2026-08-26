import { describe, expect, it } from 'vitest';
import {
  validateCard,
  validateListing,
  validateNotificationSubscription,
  validateSale,
  validateSellerProfile,
  type Card,
  type Listing,
  type NotificationSubscription,
  type Sale,
  type SellerProfile,
} from './index';
import { CARD_TYPES, cardTypeLabel, isCardType } from '../cardType';

describe('domain model validation', () => {
  it('accepts a notification subscription for complete normalized character keys', () => {
    const subscription: NotificationSubscription = {
      uid: 'buyer-1',
      characterKeys: ['諸伏 景光'],
      emailDailyEnabled: true,
      updatedAt: new Date('2026-08-25T00:00:00.000Z'),
    };

    expect(() => validateNotificationSubscription(subscription)).not.toThrow();
  });

  it('rejects notification subscriptions with an empty character key', () => {
    expect(() => validateNotificationSubscription({
      uid: 'buyer-1',
      characterKeys: [''],
      emailDailyEnabled: true,
      updatedAt: new Date('2026-08-25T00:00:00.000Z'),
    })).toThrow();
  });

  it('rejects notification subscriptions with duplicate character keys', () => {
    expect(() => validateNotificationSubscription({
      uid: 'buyer-1',
      characterKeys: ['諸伏 景光', '諸伏 景光'],
      emailDailyEnabled: true,
      updatedAt: new Date('2026-08-25T00:00:00.000Z'),
    })).toThrow();
  });

  it('rejects notification subscriptions with more than 100 character keys', () => {
    expect(() => validateNotificationSubscription({
      uid: 'buyer-1',
      characterKeys: Array.from({ length: 101 }, (_, index) => `角色-${index}`),
      emailDailyEnabled: true,
      updatedAt: new Date('2026-08-25T00:00:00.000Z'),
    })).toThrow(/at most 100/);
  });

  it('rejects notification subscriptions with an overlong character key', () => {
    expect(() => validateNotificationSubscription({
      uid: 'buyer-1',
      characterKeys: ['角'.repeat(101)],
      emailDailyEnabled: true,
      updatedAt: new Date('2026-08-25T00:00:00.000Z'),
    })).toThrow(/at most 100 characters/);
  });

  it('rejects notification subscriptions with a non-boolean email preference', () => {
    expect(() => validateNotificationSubscription({
      uid: 'buyer-1',
      characterKeys: ['諸伏 景光'],
      emailDailyEnabled: 'true',
      updatedAt: new Date('2026-08-25T00:00:00.000Z'),
    })).toThrow();
  });

  it('accepts normalized four-digit Card Master metadata', () => {
    expect(() => validateCard({
      id: '1100', cardType: 'event', cardName: '追跡開始', rarities: ['C'],
    } as Card)).not.toThrow();
  });

  it('keeps legacy aliases out of the normalized Card Master shape', () => {
    const card: Card = {
      id: '1100', cardType: 'event', cardName: '追跡開始', rarities: ['C'],
      // @ts-expect-error Card Master records have no legacy character alias.
      characterName: '追跡開始',
    };

    expect(card.cardName).toBe('追跡開始');
  });

  it('rejects Card Master IDs that are not four digits', () => {
    expect(() => validateCard({
      id: 'B10036', cardType: 'character', cardName: '鈴木園子', rarities: ['SR'],
    } as Card)).toThrow('Card id must be four digits.');
  });

  it('rejects cards with an unsupported card type', () => {
    expect(() => validateCard({
      id: '1100', cardType: 'unknown', cardName: '追跡開始', rarities: ['C'],
    } as never)).toThrow('Card requires a supported cardType.');
  });

  it('requires each card to have a card name', () => {
    const card: Card = {
      id: '0001',
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

  it('accepts a valid active listing with positive quantities', () => {
    const listing: Listing = {
      id: 'listing-1',
      sellerId: 'seller-1',
      cardId: '0001',
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

  it('requires character name and rarity snapshots on a listing', () => {
    const listing = {
      id: 'listing-1', sellerId: 'seller-1', cardId: '1096', imageUrls: ['https://example.com/card.jpg'], listingPrice: 500,
      originalQuantity: 5, remainingQuantity: 5, hasSleeve: false, supportsMyShip: false, status: 'active',
      createdAt: new Date('2026-08-17T00:00:00.000Z'), updatedAt: new Date('2026-08-17T00:00:00.000Z'),
    } as Listing;

    expect(() => validateListing(listing)).toThrow('Listing requires characterName and rarity snapshots.');
  });

  it('rejects listings without photos', () => {
    const listing: Listing = {
      id: 'listing-1',
      sellerId: 'seller-1',
      cardId: '0001',
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

  it('rejects seller profiles without contact values', () => {
    const profile: SellerProfile = {
      uid: 'seller-1',
      displayName: 'Seller',
      contactType: 'line',
      contactValue: '',
      createdAt: new Date('2026-08-17T00:00:00.000Z'),
      updatedAt: new Date('2026-08-17T00:00:00.000Z'),
    };

    expect(() => validateSellerProfile(profile)).toThrow('Seller profile requires contactValue.');
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
