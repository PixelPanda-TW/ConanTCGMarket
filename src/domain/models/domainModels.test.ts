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
  it('accepts four-digit Card Master IDs with a character name', () => {
    expect(() => validateCard({ id: '1096', characterName: '鈴木園子', rarity: 'SR' } as Card)).not.toThrow();
  });

  it('rejects Card Master IDs that are not four digits', () => {
    expect(() => validateCard({ id: 'B10036', characterName: '鈴木園子', rarity: 'SR' } as Card)).toThrow('Card id must be four digits.');
  });

  it('requires each card to have a character name', () => {
    const card: Card = {
      id: '0001',
      rarity: 'CP',
    } as Card;

    expect(() => validateCard(card)).toThrow('Card requires characterName.');
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
