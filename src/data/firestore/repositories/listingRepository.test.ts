import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  collection: vi.fn(),
  connectFirestoreEmulator: vi.fn(),
  deleteField: vi.fn(() => ({ type: 'delete-field' })),
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  getFirestore: vi.fn(() => ({ type: 'firestore' })),
  query: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  where: vi.fn(),
}));

vi.mock('firebase/firestore', () => firestore);
vi.mock('../../../lib/firebase/app', () => ({
  auth: { currentUser: { uid: 'seller-1' } },
  firebaseApp: { type: 'firebase-app' },
  firebaseEmulatorConfig: null,
}));

import {
  activeListingsQueryConstraints,
  listActiveListings,
  listSellerListings,
  sellerListingsQueryConstraints,
  updateListing,
} from './listingRepository';
import { collections } from '../paths';
import { listingConverter } from '../converters';

describe('listing repository', () => {
  const convertedCollection = { type: 'converted-listings' };
  const convertedListingDocument = { type: 'converted-listing-document' };
  const listingDocument = { withConverter: vi.fn(() => convertedListingDocument) };
  const withConverter = vi.fn(() => convertedCollection);

  beforeEach(() => {
    vi.clearAllMocks();
    firestore.collection.mockReturnValue({ withConverter });
    firestore.doc.mockReturnValue(listingDocument);
    firestore.where.mockImplementation((field, operator, value) => ({ field, operator, value }));
    firestore.query.mockImplementation((source, ...constraints) => ({ source, constraints }));
  });

  it('filters public marketplace listings to active status', () => {
    expect(activeListingsQueryConstraints()).toEqual([
      { field: 'status', operator: '==', value: 'active' },
    ]);
  });

  it('filters seller listings by sellerId', () => {
    expect(sellerListingsQueryConstraints('seller-1')).toEqual([
      { field: 'sellerId', operator: '==', value: 'seller-1' },
    ]);
  });

  it('lists active listings through the listings collection and converter', async () => {
    const listing = { id: 'listing-1' };
    firestore.getDocs.mockResolvedValue({ docs: [{ data: () => listing }] });

    await expect(listActiveListings()).resolves.toEqual([listing]);

    expect(firestore.collection).toHaveBeenCalledWith(expect.anything(), collections.listings);
    expect(withConverter).toHaveBeenCalledWith(listingConverter);
    expect(firestore.query).toHaveBeenCalledWith(convertedCollection, {
      field: 'status',
      operator: '==',
      value: 'active',
    });
    expect(firestore.getDocs).toHaveBeenCalledWith({
      source: convertedCollection,
      constraints: [{ field: 'status', operator: '==', value: 'active' }],
    });
  });

  it("lists a seller's listings through the listings converter", async () => {
    const listing = { id: 'listing-1', sellerId: 'seller-1' };
    firestore.getDocs.mockResolvedValue({ docs: [{ data: () => listing }] });

    await expect(listSellerListings('seller-1')).resolves.toEqual([listing]);

    expect(firestore.query).toHaveBeenCalledWith(convertedCollection, {
      field: 'sellerId',
      operator: '==',
      value: 'seller-1',
    });
  });

  it('updates a cardId-only legacy listing through an editable allowlist', async () => {
    const legacyListing = {
      id: 'legacy-listing', sellerId: 'seller-1', cardId: 'CT-P01-001', imageUrls: ['https://example.com/legacy.jpg'],
      listingPrice: 500, originalQuantity: 2, remainingQuantity: 2, hasSleeve: false, supportsMyShip: false,
      status: 'active' as const, createdAt: new Date('2026-08-17T00:00:00.000Z'), updatedAt: new Date('2026-08-17T00:00:00.000Z'),
    };
    firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => legacyListing });

    await expect(updateListing({
      ...legacyListing,
      listingPrice: 600,
      remainingQuantity: 0,
      status: 'sold_out',
      supportsMyShip: true,
      myShipFee: 35,
      note: '已更新',
      updatedAt: new Date('2026-08-18T00:00:00.000Z'),
    })).resolves.toBeUndefined();

    expect(firestore.updateDoc).toHaveBeenCalledWith(listingDocument, expect.objectContaining({
      imageUrls: ['https://example.com/legacy.jpg'],
      listingPrice: 600,
      remainingQuantity: 0,
      supportsMyShip: true,
      myShipFee: 35,
      note: '已更新',
      status: 'sold_out',
    }));
    const payload = firestore.updateDoc.mock.calls[0][1];
    expect(payload).not.toHaveProperty('sellerId');
    expect(payload).not.toHaveProperty('cardId');
    expect(payload).not.toHaveProperty('cardType');
    expect(payload).not.toHaveProperty('cardName');
    expect(payload).not.toHaveProperty('characterName');
    expect(payload).not.toHaveProperty('rarity');
    expect(payload).not.toHaveProperty('originalQuantity');
    expect(payload).not.toHaveProperty('createdAt');
  });
});
