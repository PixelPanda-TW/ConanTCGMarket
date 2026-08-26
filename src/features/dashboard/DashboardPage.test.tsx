// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Listing } from '../../domain/models';
import { DashboardPage } from './DashboardPage';

const repositories = vi.hoisted(() => ({
  listSellerListings: vi.fn(),
  listSellerSales: vi.fn(),
  recordSale: vi.fn(),
}));

vi.mock('../../data/firestore/repositories', () => repositories);
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ user: { uid: 'seller-1' }, isLoading: false }),
}));

const listing: Listing = {
  id: 'listing-case', sellerId: 'seller-1', cardId: '2200', cardType: 'case', cardName: '封鎖現場', rarity: 'SR',
  imageUrls: ['https://example.com/case.jpg'], listingPrice: 500, originalQuantity: 1, remainingQuantity: 1,
  hasSleeve: false, supportsMyShip: false, status: 'active', createdAt: new Date(), updatedAt: new Date(),
};

afterEach(cleanup);

describe('DashboardPage', () => {
  it('shows generic card metadata for active seller listings', async () => {
    repositories.listSellerListings.mockResolvedValue([listing]);
    repositories.listSellerSales.mockResolvedValue([]);

    render(<DashboardPage />);

    expect(await screen.findByText('Case 卡（情境卡）')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '封鎖現場' })).toBeTruthy();
    expect(screen.getByText('SR · ID 2200')).toBeTruthy();
  });
});
