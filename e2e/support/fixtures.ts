import type { Listing, Sale, SellerProfile } from '../../src/domain/models';

export const testCards = [
  {
    key: 'e2e-card-morofushi',
    cardId: '0501',
    cardType: 'character',
    cardName: '諸伏高明',
    rarities: ['D'],
  },
  {
    key: 'e2e-card-hiromitsu',
    cardId: '1096',
    cardType: 'character',
    cardName: '諸伏景光',
    rarities: ['R', 'CP'],
  },
  {
    key: 'e2e-card-event',
    cardId: '1100',
    cardType: 'event',
    cardName: '追跡開始',
    rarities: ['C'],
  },
  {
    key: 'e2e-card-partner',
    cardId: 'P001',
    cardType: 'partner',
    cardName: '江戶川柯南',
    rarities: ['P'],
  },
] as const;

const fixedDate = new Date('2026-08-27T00:00:00.000Z');

export function sellerProfile(uid: string, displayName = 'E2E 賣家'): SellerProfile {
  return {
    uid,
    displayName,
    contactType: 'line',
    contactValue: 'e2e-line',
    createdAt: fixedDate,
    updatedAt: fixedDate,
  };
}

export function activeListing(
  sellerId: string,
  imageUrl: string,
  overrides: Partial<Listing> = {},
): Listing {
  return {
    id: 'e2e-listing-active',
    sellerId,
    cardId: '0501',
    cardType: 'character',
    cardName: '諸伏高明',
    characterName: '諸伏高明',
    rarity: 'D',
    imageUrls: [imageUrl],
    listingPrice: 500,
    originalQuantity: 5,
    remainingQuantity: 5,
    hasSleeve: true,
    sleeveFee: 20,
    supportsMyShip: true,
    myShipFee: 10,
    note: 'E2E 商品備註',
    status: 'active',
    createdAt: fixedDate,
    updatedAt: fixedDate,
    ...overrides,
  };
}

export function sale(
  sellerId: string,
  listingId: string,
  overrides: Partial<Sale> = {},
): Sale {
  return {
    id: 'e2e-sale-1',
    listingId,
    sellerId,
    cardId: '0501',
    quantity: 2,
    listingUnitPrice: 500,
    soldUnitPrice: 450,
    soldAt: fixedDate,
    ...overrides,
  };
}
