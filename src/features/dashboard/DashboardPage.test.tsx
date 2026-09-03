// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Listing } from '../../domain/models';
import { DashboardPage } from './DashboardPage';

const repositories = vi.hoisted(() => ({
  listCards: vi.fn(),
  listSellerListings: vi.fn(),
  listSellerSales: vi.fn(),
  recordSale: vi.fn(),
}));
const authState = vi.hoisted(() => ({
  current: {
    user: { uid: 'seller-1' } as { uid: string } | null,
    isLoading: false,
    accountAccessState: { state: 'active', access: null } as Record<string, unknown>,
    isActiveAccount: true,
  },
}));

vi.mock('../../data/firestore/repositories', () => repositories);
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => authState.current,
}));

const listing: Listing = {
  id: 'listing-case', sellerId: 'seller-1', cardId: '2200', cardType: 'case', cardName: '封鎖現場', rarity: 'SR',
  imageUrls: ['https://example.com/case.jpg'], listingPrice: 500, originalQuantity: 1, remainingQuantity: 1,
  hasSleeve: false, supportsMyShip: false, status: 'active', createdAt: new Date(), updatedAt: new Date(),
};

afterEach(cleanup);

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.current = {
      user: { uid: 'seller-1' },
      isLoading: false,
      accountAccessState: { state: 'active', access: null },
      isActiveAccount: true,
    };
    repositories.listSellerListings.mockResolvedValue([]);
    repositories.listSellerSales.mockResolvedValue([]);
    repositories.listCards.mockResolvedValue([]);
  });

  it('keeps suspended seller history readable without mutation controls', async () => {
    authState.current.accountAccessState = {
      state: 'suspended',
      access: {
        uid: 'seller-1', status: 'suspended', confirmedViolationCount: 1,
        suspensionReason: 'Confirmed reason', suspendedAt: new Date(),
        suspendedBy: 'admin-1', updatedAt: new Date(),
      },
    };
    authState.current.isActiveAccount = false;
    repositories.listSellerListings.mockResolvedValue([
      listing,
      { ...listing, id: 'sold-listing', status: 'sold_out', remainingQuantity: 0 },
    ]);
    repositories.listSellerSales.mockResolvedValue([{
      id: 'sale-1', listingId: 'sold-listing', sellerId: 'seller-1', cardId: '2200',
      quantity: 1, listingUnitPrice: 500, soldUnitPrice: 450, soldAt: new Date(),
    }]);

    render(<DashboardPage />);

    expect((await screen.findByRole('status')).textContent).toContain('Confirmed reason');
    expect(await screen.findByText('成交金額：NT$450')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '販售中' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '已售罄' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: '編輯' })).toBeNull();
    expect(screen.queryByRole('button', { name: '登記成交' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: '登記成交' })).toBeNull();
  });

  it('does not load private dashboard data when access state is unavailable', () => {
    authState.current.accountAccessState = { state: 'unavailable', message: '請重新整理。' };
    authState.current.isActiveAccount = false;

    render(<DashboardPage />);

    expect(screen.getByRole('status').textContent).toBe('請重新整理。');
    expect(repositories.listSellerListings).not.toHaveBeenCalled();
    expect(repositories.listSellerSales).not.toHaveBeenCalled();
    expect(repositories.listCards).not.toHaveBeenCalled();
  });

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
