import { describe, expect, it } from 'vitest';
import { sellerSalesQueryConstraints } from './saleRepository';

describe('sale repository query constraints', () => {
  it('filters seller sale records by sellerId', () => {
    expect(sellerSalesQueryConstraints('seller-1')).toEqual([
      { field: 'sellerId', operator: '==', value: 'seller-1' },
    ]);
  });
});
