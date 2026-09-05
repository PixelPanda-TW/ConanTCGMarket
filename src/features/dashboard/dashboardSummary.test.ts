import { describe, expect, it } from 'vitest';
import { summarizeDashboard } from './dashboardSummary';

describe('summarizeDashboard', () => {
  it('calculates active count, sold quantity, and actual sale revenue', () => {
    expect(summarizeDashboard([
      { status: 'active' }, { status: 'sold_out' }, { status: 'suspended' },
    ], [{ quantity: 2, soldUnitPrice: 450 }, { quantity: 1, soldUnitPrice: 500 }])).toEqual({
      activeCount: 1, heldCount: 1, soldQuantity: 3, revenue: 1400,
    });
  });
});
