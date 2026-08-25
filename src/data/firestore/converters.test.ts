import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import {
  cardConverter,
  listingConverter,
  saleConverter,
  sellerProfileConverter,
  notificationSubscriptionConverter,
} from './converters';

describe('Firestore converters', () => {
  it('converts Firestore listing timestamps to Date values', () => {
    const snapshot = {
      id: 'listing-1',
      data: () => ({
        sellerId: 'seller-1',
        cardId: '1096',
        characterName: '鈴木園子',
        rarity: 'SR',
        imageUrls: ['https://example.com/card.jpg'],
        listingPrice: 500,
        originalQuantity: 5,
        remainingQuantity: 3,
        hasSleeve: true,
        supportsMyShip: true,
        status: 'active',
        createdAt: Timestamp.fromDate(new Date('2026-08-17T00:00:00.000Z')),
        updatedAt: Timestamp.fromDate(new Date('2026-08-17T01:00:00.000Z')),
      }),
    };

    expect(listingConverter.fromFirestore(snapshot as never)).toMatchObject({
      id: 'listing-1',
      createdAt: new Date('2026-08-17T00:00:00.000Z'),
      updatedAt: new Date('2026-08-17T01:00:00.000Z'),
    });
  });

  it('writes only allowlisted Card Master fields', () => {
    expect(
      cardConverter.toFirestore({
        id: '1096',
        characterName: '鈴木園子',
        rarities: ['SR', 'CP'],
        officialImageUrl: 'https://example.com/official.jpg',
        effectText: 'private card text',
        unknown: 'unknown',
      } as never),
    ).toEqual({
      characterName: '鈴木園子',
      rarities: ['SR', 'CP'],
    });
  });

  it('writes only allowlisted listing fields and omits an undefined note', () => {
    const result = listingConverter.toFirestore({
      id: 'listing-1',
      sellerId: 'seller-1',
      cardId: '1096',
      characterName: '鈴木園子',
      rarity: 'SR',
      imageUrls: ['https://example.com/card.jpg'],
      listingPrice: 500,
      originalQuantity: 2,
      remainingQuantity: 2,
      hasSleeve: true,
      supportsMyShip: false,
      note: undefined,
      status: 'active',
      createdAt: new Date('2026-08-17T00:00:00.000Z'),
      updatedAt: new Date('2026-08-17T01:00:00.000Z'),
      email: 'seller@example.com',
      unknown: 'unknown',
    } as never);

    expect(result).toEqual({
      sellerId: 'seller-1',
      cardId: '1096',
      characterName: '鈴木園子',
      rarity: 'SR',
      imageUrls: ['https://example.com/card.jpg'],
      listingPrice: 500,
      originalQuantity: 2,
      remainingQuantity: 2,
      hasSleeve: true,
      supportsMyShip: false,
      status: 'active',
      createdAt: Timestamp.fromDate(new Date('2026-08-17T00:00:00.000Z')),
      updatedAt: Timestamp.fromDate(new Date('2026-08-17T01:00:00.000Z')),
    });
  });

  it('converts seller profile timestamps to Date values', () => {
    const snapshot = {
      id: 'seller-1',
      data: () => ({
        displayName: 'Seller',
        contactType: 'line',
        contactValue: 'seller-line',
        createdAt: Timestamp.fromDate(new Date('2026-08-17T00:00:00.000Z')),
        updatedAt: Timestamp.fromDate(new Date('2026-08-17T01:00:00.000Z')),
      }),
    };

    expect(sellerProfileConverter.fromFirestore(snapshot as never)).toMatchObject({
      uid: 'seller-1',
      updatedAt: new Date('2026-08-17T01:00:00.000Z'),
    });
  });

  it('writes only allowlisted seller profile fields', () => {
    expect(
      sellerProfileConverter.toFirestore({
        uid: 'seller-1',
        displayName: 'Seller',
        contactType: 'line',
        contactValue: 'seller-line',
        createdAt: new Date('2026-08-17T00:00:00.000Z'),
        updatedAt: new Date('2026-08-17T01:00:00.000Z'),
        email: 'seller@example.com',
        unknown: 'unknown',
      } as never),
    ).toEqual({
      displayName: 'Seller',
      contactType: 'line',
      contactValue: 'seller-line',
      createdAt: Timestamp.fromDate(new Date('2026-08-17T00:00:00.000Z')),
      updatedAt: Timestamp.fromDate(new Date('2026-08-17T01:00:00.000Z')),
    });
  });

  it('converts sale timestamps to Date values', () => {
    const snapshot = {
      id: 'sale-1',
      data: () => ({
        listingId: 'listing-1',
        sellerId: 'seller-1',
        cardId: '1096',
        characterName: '鈴木園子',
        rarity: 'SR',
        quantity: 2,
        listingUnitPrice: 500,
        soldUnitPrice: 450,
        soldAt: Timestamp.fromDate(new Date('2026-08-17T00:00:00.000Z')),
      }),
    };

    expect(saleConverter.fromFirestore(snapshot as never)).toMatchObject({
      id: 'sale-1',
      soldAt: new Date('2026-08-17T00:00:00.000Z'),
    });
  });

  it('writes only allowlisted sale fields', () => {
    expect(
      saleConverter.toFirestore({
        id: 'sale-1',
        listingId: 'listing-1',
        sellerId: 'seller-1',
        cardId: 'CT-P01-001',
        quantity: 2,
        listingUnitPrice: 500,
        soldUnitPrice: 450,
        soldAt: new Date('2026-08-17T00:00:00.000Z'),
        email: 'seller@example.com',
        unknown: 'unknown',
      } as never),
    ).toEqual({
      listingId: 'listing-1',
      sellerId: 'seller-1',
      cardId: 'CT-P01-001',
      quantity: 2,
      listingUnitPrice: 500,
      soldUnitPrice: 450,
      soldAt: Timestamp.fromDate(new Date('2026-08-17T00:00:00.000Z')),
    });
  });

  it('writes only character subscription fields with an updatedAt Timestamp', () => {
    expect(
      notificationSubscriptionConverter.toFirestore({
        uid: 'buyer-1',
        characterKeys: ['suzuki-sonoko', 'mouri-ran'],
        emailDailyEnabled: true,
        updatedAt: new Date('2026-08-25T00:00:00.000Z'),
        email: 'buyer@example.com',
        unknown: 'unknown',
      } as never),
    ).toEqual({
      characterKeys: ['suzuki-sonoko', 'mouri-ran'],
      emailDailyEnabled: true,
      updatedAt: Timestamp.fromDate(new Date('2026-08-25T00:00:00.000Z')),
    });
  });

  it('converts a character subscription Timestamp to a Date value', () => {
    const snapshot = {
      id: 'buyer-1',
      data: () => ({
        characterKeys: ['suzuki-sonoko'],
        emailDailyEnabled: false,
        updatedAt: Timestamp.fromDate(new Date('2026-08-25T00:00:00.000Z')),
      }),
    };

    expect(notificationSubscriptionConverter.fromFirestore(snapshot as never)).toEqual({
      uid: 'buyer-1',
      characterKeys: ['suzuki-sonoko'],
      emailDailyEnabled: false,
      updatedAt: new Date('2026-08-25T00:00:00.000Z'),
    });
  });

  it('rejects malformed Firestore listing data', () => {
    const snapshot = {
      id: 'listing-1',
      data: () => ({
        sellerId: 'seller-1',
        cardId: 'CT-P01-001',
        imageUrls: [123],
        listingPrice: Number.POSITIVE_INFINITY,
        originalQuantity: 1.5,
        remainingQuantity: 1,
        hasSleeve: 'true',
        supportsMyShip: true,
        status: 'invalid',
        createdAt: new Date(),
        updatedAt: Timestamp.now(),
      }),
    };

    expect(() => listingConverter.fromFirestore(snapshot as never)).toThrow();
  });

  it('rejects malformed Firestore card optional fields', () => {
    const snapshot = {
      id: '1096',
      data: () => ({ characterName: 123, rarity: 'CP' }),
    };

    expect(() => cardConverter.fromFirestore(snapshot as never)).toThrow();
  });
});
