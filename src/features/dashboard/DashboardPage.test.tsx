// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Listing } from '../../domain/models';
import { DashboardPage } from './DashboardPage';

const repositories = vi.hoisted(() => ({
  listCards: vi.fn(),
  listSellerListings: vi.fn(),
  listSellerSales: vi.fn(),
  recordSale: vi.fn(),
  getOwnAccountAppeal: vi.fn(),
  submitAccountAppeal: vi.fn(),
}));
vi.mock('../../data/storage/storageService', () => ({ uploadAccountAppealEvidence: vi.fn() }));
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
const heldListing: Listing = {
  ...listing,
  id: 'held-listing',
  status: 'suspended',
  suspensionActionId: 'a'.repeat(64),
  suspendedAt: new Date('2026-09-04T06:00:00Z'),
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
    repositories.getOwnAccountAppeal.mockResolvedValue(null);
  });

  it('keeps suspended seller history readable without mutation controls', async () => {
    authState.current.accountAccessState = {
      state: 'suspended',
      access: {
        uid: 'seller-1', status: 'suspended', confirmedViolationCount: 1,
        suspensionReason: 'Confirmed reason', suspendedAt: new Date(),
        suspendedBy: 'admin-1', suspensionActionId: 'a'.repeat(64), updatedAt: new Date(),
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
    expect(await screen.findByRole('heading', { name: '申訴停權' })).toBeTruthy();
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

  it.each([
    ['active', true],
    ['suspended', false],
  ])('separates held Listings for an %s owner without changing active totals', async (_label, active) => {
    if (!active) {
      authState.current.accountAccessState = {
        state: 'suspended', access: {
          uid: 'seller-1', status: 'suspended', confirmedViolationCount: 2,
          suspensionReason: 'Reason', suspendedAt: new Date(), suspendedBy: 'admin-1',
          suspensionActionId: 'a'.repeat(64), updatedAt: new Date(),
        },
      };
      authState.current.isActiveAccount = false;
    }
    repositories.listSellerListings.mockResolvedValue([listing, heldListing]);
    render(<DashboardPage />);
    expect(await screen.findByText('販售中：1')).toBeTruthy();
    expect(screen.getByText('停權保留：1')).toBeTruthy();
    const section = screen.getByRole('region', { name: '因停權隱藏' });
    expect(section.textContent).toContain('封鎖現場');
    expect(section.querySelector('a')?.getAttribute('href')).toBe('#/listing/held-listing');
    expect(section.textContent).toContain(active ? '查看與管理' : '僅供查看');
    expect(screen.queryByRole('button', { name: '登記成交' }) !== null).toBe(active);
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

  it('renders every Sale newest-first with immutable prices, totals, and Listing links', async () => {
    const soldListing = { ...listing, id: 'sold-listing', status: 'sold_out' as const, remainingQuantity: 0 };
    repositories.listSellerListings.mockResolvedValue([listing, soldListing]);
    repositories.listSellerSales.mockResolvedValue([
      {
        id: 'sale-old', listingId: 'sold-listing', sellerId: 'seller-1', cardId: '2200',
        cardType: 'case', cardName: '舊價格封鎖現場', rarity: 'SR', quantity: 1,
        listingUnitPrice: 500, soldUnitPrice: 450,
        soldAt: new Date('2026-09-03T08:30:00.000Z'),
      },
      {
        id: 'sale-new', listingId: 'listing-case', sellerId: 'seller-1', cardId: '2200',
        cardType: 'case', cardName: '封鎖現場', rarity: 'SR', quantity: 2,
        listingUnitPrice: 600, soldUnitPrice: 550,
        soldAt: new Date('2026-09-04T08:30:00.000Z'),
      },
    ]);

    render(<DashboardPage />);

    expect(await screen.findByRole('heading', { name: '完整銷售紀錄' })).toBeTruthy();
    const rows = screen.getAllByTestId('sale-history-item');
    expect(rows.map((row) => row.getAttribute('data-sale-id'))).toEqual(['sale-new', 'sale-old']);
    expect(rows[0].textContent).toContain('2026/09/04 16:30');
    expect(rows[0].textContent).toContain('刊登單價：NT$600');
    expect(rows[0].textContent).toContain('成交單價：NT$550');
    expect(rows[0].textContent).toContain('數量：2');
    expect(rows[0].textContent).toContain('小計：NT$1,100');
    expect(rows[0].querySelector('a')?.getAttribute('href')).toBe('#/listing/listing-case');
    expect(screen.getByText('成交金額：NT$1,550')).toBeTruthy();
  });

  it('shows a complete-history empty state instead of omitting the section', async () => {
    render(<DashboardPage />);
    expect(await screen.findByText('目前沒有成交紀錄。')).toBeTruthy();
  });

  it('disables duplicate Sale submissions while the trusted callable is pending', async () => {
    repositories.listSellerListings.mockResolvedValue([listing]);
    let resolveSale!: (value: unknown) => void;
    repositories.recordSale.mockReturnValue(new Promise((resolve) => { resolveSale = resolve; }));
    render(<DashboardPage />);
    fireEvent.click(await screen.findByRole('button', { name: '登記成交' }));
    const submit = screen.getByRole('button', { name: '確認成交' });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(repositories.recordSale).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('button', { name: '成交登記中' }) as HTMLButtonElement).disabled)
      .toBe(true);
    resolveSale({});
  });
});
