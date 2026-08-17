import { describe, expect, it } from 'vitest';
import { activeListingsQueryConstraints, sellerListingsQueryConstraints } from './listingRepository';

describe('listing repository query constraints', () => {
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
});
