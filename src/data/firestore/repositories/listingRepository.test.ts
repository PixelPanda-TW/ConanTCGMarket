import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';

const firestore = vi.hoisted(() => ({
  collection: vi.fn(),
  connectFirestoreEmulator: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  getDocsFromCache: vi.fn(),
  getDocsFromServer: vi.fn(),
  getFirestore: vi.fn(() => ({ type: 'firestore' })),
  query: vi.fn(),
  where: vi.fn(),
}));
const functions = vi.hoisted(() => ({
  callableByName: new Map<string, ReturnType<typeof vi.fn>>(),
  httpsCallable: vi.fn((_client: unknown, name: string) => functions.callableByName.get(name)),
}));

vi.mock('firebase/firestore', () => firestore);
vi.mock('firebase/functions', () => functions);
vi.mock('../../../lib/firebase/app', () => ({
  auth: { currentUser: { uid: 'seller-1' } },
  firebaseApp: { type: 'firebase-app' },
  firebaseEmulatorConfig: null,
  functionsClient: { type: 'functions' },
}));

import {
  activeListingsQueryConstraints,
  listActiveListings,
  listActiveListingsFromServer,
  listSellerListings,
  sellerListingsQueryConstraints,
  deleteListing,
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
    functions.callableByName.clear();
    functions.callableByName.set('updateSellerListing', vi.fn());
    functions.callableByName.set('deleteUnsoldListing', vi.fn());
  });

  it('filters public marketplace listings to active status', () => {
    expect(activeListingsQueryConstraints()).toEqual([
      { field: 'status', operator: '==', value: 'active' },
    ]);
  });

  it('filters seller listings by sellerId and one explicit allowed status', () => {
    expect(sellerListingsQueryConstraints('seller-1', 'suspended')).toEqual([
      { field: 'sellerId', operator: '==', value: 'seller-1' },
      { field: 'status', operator: '==', value: 'suspended' },
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

  it('uses the server result first for public Marketplace freshness', async () => {
    const listing = { id: 'listing-server' };
    firestore.getDocsFromServer.mockResolvedValue({ docs: [{ data: () => listing }] });

    await expect(listActiveListingsFromServer()).resolves.toEqual([listing]);

    expect(firestore.getDocsFromCache).not.toHaveBeenCalled();
  });

  it('falls back to non-empty active Listing cache after a server failure', async () => {
    const unavailable = new Error('Firestore unavailable');
    firestore.getDocsFromServer.mockRejectedValue(unavailable);
    const cachedListing = { id: 'listing-cached' };
    firestore.getDocsFromCache.mockResolvedValue({ docs: [{ data: () => cachedListing }] });

    await expect(listActiveListingsFromServer()).resolves.toEqual([cachedListing]);

    expect(firestore.getDocsFromServer).toHaveBeenCalledWith({
      source: convertedCollection,
      constraints: [{ field: 'status', operator: '==', value: 'active' }],
    });
    expect(firestore.getDocsFromCache).toHaveBeenCalledWith({
      source: convertedCollection,
      constraints: [{ field: 'status', operator: '==', value: 'active' }],
    });
  });

  it.each([
    ['an empty cache', { docs: [] }],
    ['a failing cache', new Error('Cache unavailable')],
  ] as const)('rethrows the original active Listing server error for %s', async (_name, cacheResult) => {
    const unavailable = new Error('Firestore unavailable');
    firestore.getDocsFromServer.mockRejectedValue(unavailable);
    if (cacheResult instanceof Error) firestore.getDocsFromCache.mockRejectedValue(cacheResult);
    else firestore.getDocsFromCache.mockResolvedValue(cacheResult);

    await expect(listActiveListingsFromServer()).rejects.toBe(unavailable);
  });

  it("lists a seller's listings through the listings converter", async () => {
    const listing = { id: 'listing-1', sellerId: 'seller-1', status: 'active' };
    firestore.getDocs
      .mockResolvedValueOnce({ docs: [{ data: () => listing }] })
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [] });

    await expect(listSellerListings('seller-1')).resolves.toEqual([listing]);

    expect(firestore.query).toHaveBeenCalledTimes(3);
    for (const status of ['active', 'sold_out', 'suspended']) {
      expect(firestore.query).toHaveBeenCalledWith(
        convertedCollection,
        { field: 'sellerId', operator: '==', value: 'seller-1' },
        { field: 'status', operator: '==', value: status },
      );
    }
  });

  it('updates only editable fields through the trusted callable', async () => {
    const listing = {
      id: 'listing-1', sellerId: 'seller-1', cardId: '2200', cardType: 'case' as const,
      cardName: '封鎖現場', rarity: 'SR', imageUrls: ['https://example.com/new.jpg'],
      listingPrice: 600, originalQuantity: 2, remainingQuantity: 2,
      hasSleeve: true, sleeveFee: 10, supportsMyShip: false,
      status: 'active' as const, createdAt: new Date('2026-08-17T00:00:00.000Z'),
      updatedAt: new Date('2026-08-18T00:00:00.000Z'),
    };
    const wire = { ...listing, createdAt: listing.createdAt.valueOf(), updatedAt: 1788597000000 };
    const callable = functions.callableByName.get('updateSellerListing')!;
    callable.mockResolvedValue({ data: wire });

    await expect(updateListing(listing)).resolves.toEqual({
      ...listing, updatedAt: new Date(1788597000000),
    });
    expect(callable).toHaveBeenCalledWith({
      listingId: 'listing-1', expectedUpdatedAt: listing.updatedAt.valueOf(),
      imageUrls: ['https://example.com/new.jpg'], listingPrice: 600,
      hasSleeve: true, sleeveFee: 10, supportsMyShip: false, myShipFee: null,
      note: null,
    });
  });

  it.each([
    ['character snapshot', {
      characterName: '鈴木園子', rarity: 'SR',
    }, {
      cardType: 'character', cardName: '鈴木園子', characterName: '鈴木園子', rarity: 'SR',
    }],
    ['card-ID-only', {}, {}],
  ])('accepts and normalizes a strict legacy Listing response: %s', async (_name, legacyFields, expectedMetadata) => {
    const listing = {
      id: 'listing-legacy', sellerId: 'seller-1', cardId: 'legacy-id',
      imageUrls: ['https://example.com/legacy.jpg'], listingPrice: 300,
      originalQuantity: 1, remainingQuantity: 1, hasSleeve: false,
      supportsMyShip: false, status: 'active' as const,
      createdAt: new Date('2026-08-17T00:00:00.000Z'),
      updatedAt: new Date('2026-08-18T00:00:00.000Z'),
      ...legacyFields,
    };
    functions.callableByName.get('updateSellerListing')!.mockResolvedValue({
      data: { ...listing, createdAt: listing.createdAt.valueOf(), updatedAt: 1788597000000 },
    });

    await expect(updateListing(listing)).resolves.toMatchObject({
      ...listing, ...expectedMetadata, updatedAt: new Date(1788597000000),
    });
  });

  it('rejects partial normalized metadata in a legacy-shaped Listing response', async () => {
    const listing = {
      id: 'listing-legacy', sellerId: 'seller-1', cardId: '0501', cardType: 'event' as const,
      imageUrls: ['https://example.com/legacy.jpg'], listingPrice: 300,
      originalQuantity: 1, remainingQuantity: 1, hasSleeve: false,
      supportsMyShip: false, status: 'active' as const,
      createdAt: new Date('2026-08-17T00:00:00.000Z'),
      updatedAt: new Date('2026-08-18T00:00:00.000Z'),
    };
    functions.callableByName.get('updateSellerListing')!.mockResolvedValue({
      data: { ...listing, createdAt: listing.createdAt.valueOf(), updatedAt: 1788597000000 },
    });
    await expect(updateListing(listing)).rejects.toThrow('invalid listing response');
  });

  it('preserves the exact suspension hold fields in a trusted edit response', async () => {
    const listing = {
      id: 'listing-held', sellerId: 'seller-1', cardId: '2200', cardType: 'case' as const,
      cardName: '封鎖現場', rarity: 'SR', imageUrls: ['https://example.com/card.jpg'],
      listingPrice: 500, originalQuantity: 1, remainingQuantity: 1,
      hasSleeve: false, supportsMyShip: false, status: 'suspended' as const,
      suspensionActionId: 'a'.repeat(64), suspendedAt: new Date('2026-09-04T06:00:00Z'),
      createdAt: new Date('2026-08-17T00:00:00Z'), updatedAt: new Date('2026-08-18T00:00:00Z'),
    };
    functions.callableByName.get('updateSellerListing')!.mockResolvedValue({ data: {
      ...listing,
      createdAt: listing.createdAt.valueOf(),
      suspendedAt: listing.suspendedAt.valueOf(),
      updatedAt: 1_788_624_000_000,
    } });
    await expect(updateListing(listing)).resolves.toEqual({
      ...listing, updatedAt: new Date(1_788_624_000_000),
    });
  });

  it('deletes by version and returns only strict stored image URLs', async () => {
    const callable = functions.callableByName.get('deleteUnsoldListing')!;
    callable.mockResolvedValue({ data: { imageUrls: ['https://example.com/card.jpg'] } });
    await expect(deleteListing({
      id: 'listing-1', sellerId: 'seller-1', updatedAt: new Date('2026-08-18T00:00:00Z'),
    })).resolves.toEqual(['https://example.com/card.jpg']);
    expect(callable).toHaveBeenCalledWith({
      listingId: 'listing-1', expectedUpdatedAt: new Date('2026-08-18T00:00:00Z').valueOf(),
    });
  });

  it.each([
    ['extra update field', { id: 'listing-1', extra: true }],
    ['invalid update date', { id: 'listing-1', updatedAt: Number.NaN }],
  ])('rejects malformed update response: %s', async (_name, data) => {
    functions.callableByName.get('updateSellerListing')!.mockResolvedValue({ data });
    const listing = {
      id: 'listing-1', sellerId: 'seller-1', cardId: '2200', cardType: 'case' as const,
      cardName: '封鎖現場', rarity: 'SR', imageUrls: ['https://example.com/card.jpg'],
      listingPrice: 500, originalQuantity: 1, remainingQuantity: 1,
      hasSleeve: false, supportsMyShip: false, status: 'active' as const,
      createdAt: new Date(), updatedAt: new Date(),
    };
    await expect(updateListing(listing)).rejects.toThrow('invalid listing response');
  });

  it('rejects malformed delete responses', async () => {
    functions.callableByName.get('deleteUnsoldListing')!.mockResolvedValue({
      data: { imageUrls: ['javascript:alert(1)'], extra: true },
    });
    await expect(deleteListing({
      id: 'listing-1', sellerId: 'seller-1', updatedAt: new Date(),
    })).rejects.toThrow('invalid listing deletion response');
  });

  it('contains no direct existing-Listing mutation dependency', async () => {
    const source = await readFile(new URL('./listingRepository.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/updateDoc|deleteDoc|runTransaction/u);
  });
});
