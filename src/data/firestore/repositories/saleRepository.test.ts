import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  collection: vi.fn(),
  getDocs: vi.fn(),
  getFirestore: vi.fn(() => ({ type: 'firestore' })),
  query: vi.fn(),
  where: vi.fn(),
}));

vi.mock('firebase/firestore', () => firestore);

import { listSellerSales, sellerSalesQueryConstraints } from './saleRepository';
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
