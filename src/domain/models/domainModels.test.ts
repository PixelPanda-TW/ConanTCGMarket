import { describe, expect, it } from 'vitest';
import {
  validateCard,
  validateListing,
  validateSale,
  validateSellerProfile,
  type Card,
  type Listing,
  type Sale,
  type SellerProfile,
} from './index';

describe('domain model validation', () => {
  it('requires each card to have a Chinese or Japanese name', () => {
    const card: Card = {
      id: 'CT-P01-001',
      rarity: 'CP',
    };

    expect(() => validateCard(card)).toThrow('Card requires nameZh or nameJa.');
  });

  it('accepts a valid active listing with positive quantities', () => {
    const listing: Listing = {
      id: 'listing-1',
      sellerId: 'seller-1',
      cardId: 'CT-P01-001',
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

  it('rejects listings without photos', () => {
    const listing: Listing = {
      id: 'listing-1',
      sellerId: 'seller-1',
      cardId: 'CT-P01-001',
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
      cardId: 'CT-P01-001',
      quantity: 0,
      listingUnitPrice: 500,
      soldUnitPrice: 450,
      soldAt: new Date('2026-08-17T00:00:00.000Z'),
    };

    expect(() => validateSale(sale)).toThrow('Sale quantity must be greater than 0.');
  });
});
