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
      { ...listing, id: 'legacy-active', cardId: '1100', cardType: undefined, cardName: undefined, rarity: undefined },
      { ...listing, id: 'legacy-sold-out', cardId: '2200', cardType: undefined, cardName: undefined, rarity: undefined, status: 'sold_out' },
    ]);
    repositories.listSellerSales.mockResolvedValue([]);
    repositories.listCards.mockResolvedValue([
      { key: 'card_event', cardId: '1100', cardType: 'event', cardName: '舊版事件', rarities: ['CP'] },
      { key: 'card_partner', cardId: '2200', cardType: 'partner', cardName: '舊版拍檔', rarities: ['P'] },
    ]);

    render(<DashboardPage />);

    expect(await screen.findByRole('heading', { name: '舊版事件' })).toBeTruthy();
    expect(screen.getByText('CP · ID 1100')).toBeTruthy();
    expect(screen.getByText('Partner 卡（拍檔卡）')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '舊版拍檔' })).toBeTruthy();
    expect(screen.getByText('P · ID 2200')).toBeTruthy();
  });

  it('shows ambiguity for active and sold-out Listings sharing a Card Master visible ID', async () => {
    repositories.listSellerListings.mockResolvedValue([
      { ...listing, id: 'legacy-active', cardId: '0501', cardType: undefined, cardName: undefined, rarity: undefined },
      { ...listing, id: 'legacy-sold-out', cardId: '0501', cardType: undefined, cardName: undefined, rarity: undefined, status: 'sold_out' },
    ]);
    repositories.listSellerSales.mockResolvedValue([]);
    repositories.listCards.mockResolvedValue([
      { key: 'card_character', cardId: '0501', cardType: 'character', cardName: '諸伏高明', rarities: ['D'] },
      { key: 'card_event', cardId: '0501', cardType: 'event', cardName: '事件 0501', rarities: ['C'] },
    ]);

    render(<DashboardPage />);

    expect(await screen.findAllByRole('heading', { name: '卡片資料不明確' })).toHaveLength(2);
    expect(screen.queryByRole('heading', { name: '諸伏高明' })).toBeNull();
    expect(screen.queryByRole('heading', { name: '事件 0501' })).toBeNull();
  });
});
