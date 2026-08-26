// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Listing } from '../../domain/models';
import { DashboardPage } from './DashboardPage';

const repositories = vi.hoisted(() => ({
  listCards: vi.fn(),
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
    repositories.listCards.mockResolvedValue([]);

    render(<DashboardPage />);

    expect(await screen.findByText('Case 卡（情境卡）')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '封鎖現場' })).toBeTruthy();
    expect(screen.getByText('SR · ID 2200')).toBeTruthy();
  });

  it('resolves cardId-only legacy metadata from Card Master for active and sold-out listings', async () => {
    repositories.listSellerListings.mockResolvedValue([
      { ...listing, id: 'legacy-active', cardId: 'CT-P01-001', cardType: undefined, cardName: undefined, rarity: undefined },
      { ...listing, id: 'legacy-sold-out', cardId: 'CT-P01-002', cardType: undefined, cardName: undefined, rarity: undefined, status: 'sold_out' },
    ]);
    repositories.listSellerSales.mockResolvedValue([]);
    repositories.listCards.mockResolvedValue([
      { key: 'event_CT-P01-001', cardId: 'CT-P01-001', cardType: 'event', cardName: '舊版事件', rarities: ['CP'] },
      { key: 'partner_CT-P01-002', cardId: 'CT-P01-002', cardType: 'partner', cardName: '舊版拍檔', rarities: ['P'] },
    ]);

    render(<DashboardPage />);

    expect(await screen.findByRole('heading', { name: '舊版事件' })).toBeTruthy();
    expect(screen.getByText('CP · ID CT-P01-001')).toBeTruthy();
    expect(screen.getByText('Partner 卡（拍檔卡）')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '舊版拍檔' })).toBeTruthy();
    expect(screen.getByText('P · ID CT-P01-002')).toBeTruthy();
  });
});
