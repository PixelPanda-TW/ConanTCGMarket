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
        cardType: 'character',
        cardName: '鈴木園子',
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
      cardType: 'character',
      cardName: '鈴木園子',
      createdAt: new Date('2026-08-17T00:00:00.000Z'),
      updatedAt: new Date('2026-08-17T01:00:00.000Z'),
    });
  });

  it('converts a composite-key Card Master document to the normalized shape', () => {
    const snapshot = {
      id: 'card_abc',
      data: () => ({
        cardId: 'P001', cardType: 'partner', cardName: '江戶川柯南', rarities: ['P'],
      }),
    };

    expect(cardConverter.fromFirestore(snapshot as never)).toEqual({
      key: 'card_abc', cardId: 'P001', cardType: 'partner', cardName: '江戶川柯南', rarities: ['P'],
    });
  });

  it('converts a legacy Card Master document using its document ID as cardId', () => {
    const snapshot = {
      id: '0501',
      data: () => ({ characterName: '諸伏高明', rarities: ['D'] }),
    };

    expect(cardConverter.fromFirestore(snapshot as never, {} as never)).toEqual({
      key: '0501', cardId: '0501', cardType: 'character', cardName: '諸伏高明', rarities: ['D'],
    });
  });

  it('converts a legacy nameZh Card Master field to cardName', () => {
    const snapshot = {
      id: '0502',
      data: () => ({ nameZh: '毛利蘭', rarities: ['SR'] }),
    };

    expect(cardConverter.fromFirestore(snapshot as never)).toEqual({
      key: '0502', cardId: '0502', cardType: 'character', cardName: '毛利蘭', rarities: ['SR'],
    });
  });

  it('converts a legacy nameJa Card Master field to cardName', () => {
    const snapshot = {
      id: '0503',
      data: () => ({ nameJa: '江戸川コナン', rarities: ['R'] }),
    };

    expect(cardConverter.fromFirestore(snapshot as never)).toEqual({
      key: '0503', cardId: '0503', cardType: 'character', cardName: '江戸川コナン', rarities: ['R'],
    });
  });

  it('writes cardId with the allowlisted Card Master fields', () => {
    expect(cardConverter.toFirestore({
      key: 'card_abc', cardId: 'P001', cardType: 'partner', cardName: '江戶川柯南', rarities: ['P'],
      officialImageUrl: 'https://example.com/official.jpg', effectText: 'private card text', unknown: 'unknown',
    } as never)).toEqual({
      cardId: 'P001', cardType: 'partner', cardName: '江戶川柯南', rarities: ['P'],
    });
  });

  it('writes only allowlisted listing fields and omits an undefined note', () => {
    const result = listingConverter.toFirestore({
      id: 'listing-1',
      sellerId: 'seller-1',
      cardId: '1096',
      cardType: 'character',
      cardName: '鈴木園子',
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
      cardType: 'character',
      cardName: '鈴木園子',
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

  it('writes generic event listing metadata without a characterName field', () => {
    const result = listingConverter.toFirestore({
      id: 'listing-event', sellerId: 'seller-1', cardId: '1100', cardType: 'event', cardName: '追跡開始', rarity: 'C',
      imageUrls: ['https://example.com/card.jpg'], listingPrice: 500, originalQuantity: 1, remainingQuantity: 1,
      hasSleeve: false, supportsMyShip: false, status: 'active',
      createdAt: new Date('2026-08-17T00:00:00.000Z'), updatedAt: new Date('2026-08-17T01:00:00.000Z'),
    });

    expect(result).toMatchObject({
      sellerId: 'seller-1', cardId: '1100', cardType: 'event', cardName: '追跡開始', rarity: 'C',
    });
    expect(result).not.toHaveProperty('characterName');
  });

  it('maps a legacy characterName-only Listing to a character snapshot', () => {
    const snapshot = {
      id: 'legacy-listing',
      data: () => ({
        sellerId: 'seller-1', cardId: 'CT-P01-001', characterName: '鈴木園子', rarity: 'SR', imageUrls: ['https://example.com/card.jpg'],
        listingPrice: 500, originalQuantity: 1, remainingQuantity: 1, hasSleeve: false, supportsMyShip: false, status: 'active',
        createdAt: Timestamp.fromDate(new Date('2026-08-17T00:00:00.000Z')),
        updatedAt: Timestamp.fromDate(new Date('2026-08-17T01:00:00.000Z')),
      }),
    };

    expect(listingConverter.fromFirestore(snapshot as never)).toMatchObject({
      cardType: 'character', cardName: '鈴木園子', characterName: '鈴木園子',
    });
  });

  it('rejects a partial normalized event Listing that contains characterName', () => {
    const snapshot = {
      id: 'partial-event-listing',
      data: () => ({
        sellerId: 'seller-1', cardId: '1100', cardType: 'event', characterName: '偽角色', rarity: 'C', imageUrls: ['https://example.com/card.jpg'],
        listingPrice: 500, originalQuantity: 1, remainingQuantity: 1, hasSleeve: false, supportsMyShip: false, status: 'active',
        createdAt: Timestamp.fromDate(new Date('2026-08-17T00:00:00.000Z')),
        updatedAt: Timestamp.fromDate(new Date('2026-08-17T01:00:00.000Z')),
      }),
    };

    expect(() => listingConverter.fromFirestore(snapshot as never))
      .toThrow('Non-character Listing cannot contain characterName.');
  });

  it('does not map characterName to cardName when a normalized Listing field is present', () => {
    const snapshot = {
      id: 'partial-character-listing',
      data: () => ({
        sellerId: 'seller-1', cardId: '1096', cardType: 'character', characterName: '鈴木園子', rarity: 'SR', imageUrls: ['https://example.com/card.jpg'],
        listingPrice: 500, originalQuantity: 1, remainingQuantity: 1, hasSleeve: false, supportsMyShip: false, status: 'active',
        createdAt: Timestamp.fromDate(new Date('2026-08-17T00:00:00.000Z')),
        updatedAt: Timestamp.fromDate(new Date('2026-08-17T01:00:00.000Z')),
      }),
    };

    expect(() => listingConverter.fromFirestore(snapshot as never))
      .toThrow('Listing requires cardType, cardName, and rarity snapshots.');
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
      data: () => ({ cardType: 'character', cardName: 123, rarities: ['CP'] }),
    };

    expect(() => cardConverter.fromFirestore(snapshot as never)).toThrow();
  });
});
