import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  collection: vi.fn(),
  doc: vi.fn(),
  getDocs: vi.fn(),
  getFirestore: vi.fn(() => ({ type: 'firestore' })),
  query: vi.fn(),
  runTransaction: vi.fn(),
  where: vi.fn(),
}));
const auth = vi.hoisted(() => ({ currentUser: { uid: 'seller-1' as string | null } }));

vi.mock('firebase/firestore', () => firestore);
vi.mock('../../../lib/firebase/app', () => ({ auth, firebaseApp: { type: 'app' } }));

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
  });

  it('records a partial sale and decreases remaining inventory atomically', async () => {
    const listing = { id: 'listing-1', sellerId: 'seller-1', cardId: 'CP-001', listingPrice: 500, remainingQuantity: 5 };
    const listingRef = { withConverter: vi.fn(function (this: object) { return this; }) };
    const saleRef = { id: 'sale-1', withConverter: vi.fn(function (this: object) { return this; }) };
    const transaction = { get: vi.fn().mockResolvedValue({ exists: () => true, data: () => listing }), set: vi.fn(), update: vi.fn() };
    firestore.doc.mockReturnValueOnce(listingRef).mockReturnValueOnce(saleRef).mockReturnValueOnce(saleRef);
    firestore.runTransaction.mockImplementation((_db: unknown, operation: (value: typeof transaction) => unknown) => operation(transaction));

    await expect(recordSale('listing-1', 2, 450)).resolves.toMatchObject({ quantity: 2, soldUnitPrice: 450, listingUnitPrice: 500 });
    expect(transaction.update).toHaveBeenCalledWith(listingRef, expect.objectContaining({ remainingQuantity: 3, status: 'active' }));
  });

  it('marks the listing sold out and rejects overselling', async () => {
    const listing = { id: 'listing-1', sellerId: 'seller-1', cardId: 'CP-001', listingPrice: 500, remainingQuantity: 2 };
    const listingRef = { withConverter: vi.fn(function (this: object) { return this; }) };
    const saleRef = { id: 'sale-1', withConverter: vi.fn(function (this: object) { return this; }) };
    const transaction = { get: vi.fn().mockResolvedValue({ exists: () => true, data: () => listing }), set: vi.fn(), update: vi.fn() };
    firestore.doc.mockReturnValueOnce(listingRef).mockReturnValueOnce(saleRef).mockReturnValueOnce(saleRef);
    firestore.runTransaction.mockImplementation((_db: unknown, operation: (value: typeof transaction) => unknown) => operation(transaction));

    await expect(recordSale('listing-1', 2, 500)).resolves.toMatchObject({ quantity: 2 });
    expect(transaction.update).toHaveBeenCalledWith(listingRef, expect.objectContaining({ remainingQuantity: 0, status: 'sold_out' }));
    firestore.doc.mockReturnValueOnce(listingRef);
    await expect(recordSale('listing-1', 3, 500)).rejects.toThrow('Sale quantity exceeds remaining inventory.');
  });

  it('rejects a sale attempt from a non-owner before writing', async () => {
    auth.currentUser = { uid: 'seller-2' };
    const listingRef = { withConverter: vi.fn(function (this: object) { return this; }) };
    const transaction = {
      get: vi.fn().mockResolvedValue({ exists: () => true, data: () => ({ sellerId: 'seller-1', remainingQuantity: 2 }) }),
      set: vi.fn(), update: vi.fn(),
    };
    firestore.doc.mockReturnValueOnce(listingRef);
    firestore.runTransaction.mockImplementation((_db: unknown, operation: (value: typeof transaction) => unknown) => operation(transaction));

    await expect(recordSale('listing-1', 1, 500)).rejects.toThrow('Only the listing owner can record sales.');
    expect(transaction.set).not.toHaveBeenCalled();
    expect(transaction.update).not.toHaveBeenCalled();
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
