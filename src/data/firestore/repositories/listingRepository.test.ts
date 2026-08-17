import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  collection: vi.fn(),
  getDocs: vi.fn(),
  getFirestore: vi.fn(() => ({ type: 'firestore' })),
  query: vi.fn(),
  where: vi.fn(),
}));

vi.mock('firebase/firestore', () => firestore);

import {
  activeListingsQueryConstraints,
  listActiveListings,
  listSellerListings,
  sellerListingsQueryConstraints,
} from './listingRepository';
import { collections } from '../paths';
import { listingConverter } from '../converters';

describe('listing repository', () => {
  const convertedCollection = { type: 'converted-listings' };
  const withConverter = vi.fn(() => convertedCollection);

  beforeEach(() => {
    vi.clearAllMocks();
    firestore.collection.mockReturnValue({ withConverter });
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
});
