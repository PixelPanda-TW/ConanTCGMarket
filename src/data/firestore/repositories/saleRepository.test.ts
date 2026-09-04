import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';

const firestore = vi.hoisted(() => ({
  collection: vi.fn(),
  connectFirestoreEmulator: vi.fn(),
  getDocs: vi.fn(),
  getFirestore: vi.fn(() => ({ type: 'firestore' })),
  query: vi.fn(),
  where: vi.fn(),
}));
const functions = vi.hoisted(() => ({
  callable: vi.fn(),
  httpsCallable: vi.fn(() => functions.callable),
}));
const auth = vi.hoisted(() => ({ currentUser: { uid: 'seller-1' as string | null } }));

vi.mock('firebase/firestore', () => firestore);
vi.mock('firebase/functions', () => functions);
vi.mock('../../../lib/firebase/app', () => ({
  auth, firebaseApp: { type: 'app' }, firebaseEmulatorConfig: null,
  functionsClient: { type: 'functions' },
}));

import { listSellerSales, recordSale, sellerSalesQueryConstraints } from './saleRepository';
import { collections } from '../paths';
import { saleConverter } from '../converters';

describe('sale repository', () => {
  const convertedCollection = { type: 'converted-sales' };
  const withConverter = vi.fn(() => convertedCollection);

  beforeEach(() => {
    vi.clearAllMocks();
    firestore.collection.mockReturnValue({ withConverter });
    firestore.where.mockImplementation((field, operator, value) => ({ field, operator, value }));
    firestore.query.mockImplementation((source, ...constraints) => ({ source, constraints }));
    auth.currentUser = { uid: 'seller-1' };
    functions.callable.mockReset();
  });

  it('records a Sale through the exact trusted callable and adopts its response', async () => {
    functions.callable.mockResolvedValue({ data: {
      sale: {
        id: 'sale-1', listingId: 'listing-1', sellerId: 'seller-1', cardId: '2200',
        cardType: 'case', cardName: '封鎖現場', rarity: 'SR', quantity: 2,
        listingUnitPrice: 500, soldUnitPrice: 450, soldAt: 1788510600000,
      },
      listing: { remainingQuantity: 3, status: 'active', updatedAt: 1788510600000 },
    } });

    await expect(recordSale('listing-1', 2, 450)).resolves.toEqual({
      sale: {
        id: 'sale-1', listingId: 'listing-1', sellerId: 'seller-1', cardId: '2200',
        cardType: 'case', cardName: '封鎖現場', rarity: 'SR', quantity: 2,
        listingUnitPrice: 500, soldUnitPrice: 450, soldAt: new Date(1788510600000),
      },
      listing: { remainingQuantity: 3, status: 'active', updatedAt: new Date(1788510600000) },
    });
    expect(functions.httpsCallable).toHaveBeenCalledWith({ type: 'functions' }, 'recordListingSale');
    expect(functions.callable).toHaveBeenCalledWith({ listingId: 'listing-1', quantity: 2, soldUnitPrice: 450 });
  });

  it.each([
    ['extra field', { sale: { extra: true }, listing: {} }],
    ['legacy Sale response', { sale: { id: 'sale-1' }, listing: {} }],
    ['invalid availability', {
      sale: {
        id: 'sale-1', listingId: 'listing-1', sellerId: 'seller-1', cardId: '2200',
        cardType: 'case', cardName: '封鎖現場', rarity: 'SR', quantity: 2,
        listingUnitPrice: 500, soldUnitPrice: 450, soldAt: 1788510600000,
      },
      listing: { remainingQuantity: 0, status: 'active', updatedAt: 1788510600000 },
    }],
  ])('rejects malformed callable result: %s', async (_name, data) => {
    functions.callable.mockResolvedValue({ data });
    await expect(recordSale('listing-1', 2, 450)).rejects.toThrow('invalid sale response');
  });

  it('contains no direct Sale or Listing mutation dependency', async () => {
    const source = await readFile(new URL('./saleRepository.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/runTransaction|transaction\.set|transaction\.update|updateDoc|deleteDoc/u);
  });

  it('filters seller sale records by sellerId', () => {
    expect(sellerSalesQueryConstraints('seller-1')).toEqual([
      { field: 'sellerId', operator: '==', value: 'seller-1' },
    ]);
  });

  it('lists seller sales through the sales collection and converter', async () => {
    const sale = { id: 'sale-1', sellerId: 'seller-1' };
    firestore.getDocs.mockResolvedValue({ docs: [{ data: () => sale }] });

    await expect(listSellerSales('seller-1')).resolves.toEqual([sale]);

    expect(firestore.collection).toHaveBeenCalledWith(expect.anything(), collections.sales);
    expect(withConverter).toHaveBeenCalledWith(saleConverter);
    expect(firestore.query).toHaveBeenCalledWith(convertedCollection, {
      field: 'sellerId',
      operator: '==',
      value: 'seller-1',
    });
    expect(firestore.getDocs).toHaveBeenCalledWith({
      source: convertedCollection,
      constraints: [{ field: 'sellerId', operator: '==', value: 'seller-1' }],
    });
  });
});
