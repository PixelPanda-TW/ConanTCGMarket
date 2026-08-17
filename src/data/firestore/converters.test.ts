import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import {
  cardConverter,
  listingConverter,
  saleConverter,
  sellerProfileConverter,
} from './converters';

describe('Firestore converters', () => {
  it('converts Firestore listing timestamps to Date values', () => {
    const snapshot = {
      id: 'listing-1',
      data: () => ({
        sellerId: 'seller-1',
        cardId: 'CT-P01-001',
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

  it('omits model ids when writing document data', () => {
    expect(
      cardConverter.toFirestore({
        id: 'CT-P01-001',
        nameZh: '諸伏景光',
        rarity: 'CP',
      }),
    ).toEqual({
      nameZh: '諸伏景光',
      rarity: 'CP',
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

  it('converts sale timestamps to Date values', () => {
    const snapshot = {
      id: 'sale-1',
      data: () => ({
        listingId: 'listing-1',
        sellerId: 'seller-1',
        cardId: 'CT-P01-001',
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
});
