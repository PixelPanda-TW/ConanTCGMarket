// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card, Listing, SellerProfile } from '../../domain/models';
import { ListingPage } from './ListingPage';

const repositories = vi.hoisted(() => ({
  addNotificationCardName: vi.fn(),
  getListing: vi.fn(),
  getNotificationSubscription: vi.fn(),
  getPublicSellerProfile: vi.fn(),
  listCards: vi.fn(),
  removeNotificationCardName: vi.fn(),
}));
const authState = vi.hoisted(() => ({
  current: {
    user: null as { uid: string } | null,
    isLoading: false,
    error: null,
    accountAccessState: { state: 'signed-out' } as Record<string, unknown>,
    isActiveAccount: false,
    signIn: vi.fn(),
    signOut: vi.fn(),
  },
}));

vi.mock('../../data/firestore/repositories', () => repositories);
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => authState.current,
}));

const cards: Card[] = [
  { key: 'character_0338', cardId: '0338', cardType: 'character', cardName: '諸伏景光', rarities: ['R'] },
  { key: 'event_1100', cardId: '1100', cardType: 'event', cardName: '追跡開始', rarities: ['C'] },
  { key: 'case_1200', cardId: '1200', cardType: 'case', cardName: '緋色の真相', rarities: ['C'] },
  { key: 'partner_P001', cardId: 'P001', cardType: 'partner', cardName: '江戶川柯南', rarities: ['P'] },
];
const listing: Listing = {
  id: 'listing-1',
  sellerId: 'seller-1',
  cardId: '0338',
  characterName: '諸伏景光',
  rarity: 'R',
  imageUrls: ['https://example.com/card.jpg'],
  listingPrice: 500,
  originalQuantity: 1,
  remainingQuantity: 1,
  hasSleeve: false,
  supportsMyShip: false,
  status: 'active',
  createdAt: new Date(),
  updatedAt: new Date(),
};
const seller: SellerProfile = {
  uid: 'seller-1',
  displayName: 'Seller',
  contactType: 'line',
  contactValue: 'seller',
  createdAt: new Date(),
  updatedAt: new Date(),
};

afterEach(cleanup);

describe('ListingPage card-name subscriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repositories.getListing.mockResolvedValue(listing);
    repositories.listCards.mockResolvedValue(cards);
    repositories.getPublicSellerProfile.mockResolvedValue(seller);
    repositories.getNotificationSubscription.mockResolvedValue(null);
    authState.current.user = null;
    authState.current.accountAccessState = { state: 'signed-out' };
    authState.current.isActiveAccount = false;
  });

  it('shows management only to the active Listing owner', async () => {
    authState.current.user = { uid: 'seller-1' };
    authState.current.accountAccessState = { state: 'active', access: null };
    authState.current.isActiveAccount = true;
    const view = render(<ListingPage id="listing-1" />);
    expect(await screen.findByRole('link', { name: '管理此商品' })).toBeTruthy();

    authState.current.accountAccessState = {
      state: 'suspended',
      access: {
        uid: 'seller-1', status: 'suspended', confirmedViolationCount: 1,
        suspensionReason: 'Reason', suspendedAt: new Date(), suspendedBy: 'admin-1',
        updatedAt: new Date(),
      },
    };
    authState.current.isActiveAccount = false;
    view.rerender(<ListingPage id="listing-1" />);

    expect(screen.getByRole('heading', { name: '商品詳情' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: '管理此商品' })).toBeNull();
  });

  it.each([
    ['character', '諸伏景光', '0338', 'R'],
    ['event', '追跡開始', '1100', 'C'],
    ['case', '緋色の真相', '1200', 'C'],
    ['partner', '江戶川柯南', 'P001', 'P'],
  ] as const)('offers notification subscription for a resolved %s snapshot', async (cardType, cardName, cardId, rarity) => {
    repositories.getListing.mockResolvedValue({
      ...listing,
      cardType,
      cardName,
      cardId,
      rarity,
    });

    render(<ListingPage id={`listing-${cardType}`} />);

    expect(await screen.findByRole('button', { name: `訂閱${cardName}` })).toBeTruthy();
  });

  it('does not offer notification subscription for a snapshot name absent from Card Master', async () => {
    repositories.getListing.mockResolvedValue({ ...listing, cardType: 'character', cardName: '諸伏' });

    render(<ListingPage id="listing-1" />);

    expect(await screen.findByRole('heading', { name: '諸伏' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /訂閱諸伏/ })).toBeNull();
  });

  it('hides the previous card-name control immediately when navigating to another listing', async () => {
    const view = render(<ListingPage id="listing-1" />);
    expect(await screen.findByRole('button', { name: '訂閱諸伏景光' })).toBeTruthy();
    repositories.getListing.mockResolvedValueOnce({
      ...listing,
      id: 'listing-2',
      cardType: 'character',
      cardName: '諸伏',
    });
    repositories.listCards.mockReturnValueOnce(new Promise(() => undefined));

    view.rerender(<ListingPage id="listing-2" />);

    expect(await screen.findByRole('heading', { name: '諸伏' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /訂閱諸伏/ })).toBeNull();
  });

  it('shows ambiguity and no subscription for ambiguous legacy metadata', async () => {
    repositories.getListing.mockResolvedValue({
      ...listing,
      cardId: '0501',
      characterName: undefined,
      rarity: undefined,
    });
    repositories.listCards.mockResolvedValue([
      { key: 'card_character', cardId: '0501', cardType: 'character', cardName: '諸伏高明', rarities: ['D'] },
      { key: 'card_event', cardId: '0501', cardType: 'event', cardName: '事件 0501', rarities: ['C'] },
    ]);

    render(<ListingPage id="listing-1" />);

    expect(await screen.findByRole('heading', { name: '卡片資料不明確' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /訂閱/ })).toBeNull();
  });

  it('shows unavailable metadata and no subscription when a legacy card cannot be resolved', async () => {
    repositories.getListing.mockResolvedValue({
      ...listing,
      cardId: '9999',
      characterName: undefined,
      cardType: undefined,
      cardName: undefined,
      rarity: undefined,
    });

    render(<ListingPage id="listing-missing" />);

    expect(await screen.findByRole('heading', { name: '未提供卡片名稱' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /訂閱/ })).toBeNull();
  });

  describe('seller contact presentation', () => {
    it('renders LINE as an encoded external ID link', async () => {
      repositories.getPublicSellerProfile.mockResolvedValue({
        ...seller,
        contactType: 'line',
        contactValue: '@seller',
      });

      render(<ListingPage id="listing-1" />);

      const link = await screen.findByRole('link', { name: 'LINE ID：@seller' });
      expect(link.getAttribute('href')).toBe('https://line.me/ti/p/~%40seller');
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noreferrer');
    });

    it('renders Discord as plain ID text', async () => {
      repositories.getPublicSellerProfile.mockResolvedValue({
        ...seller,
        contactType: 'discord',
        contactValue: 'seller_name',
      });

      render(<ListingPage id="listing-1" />);

      expect(await screen.findByText('Discord ID：seller_name')).toBeTruthy();
      expect(screen.queryByRole('link', { name: 'Discord ID：seller_name' })).toBeNull();
    });

    it.each([
      ['facebook', 'https://www.facebook.com/seller', 'Facebook 個人頁面'],
      ['threads', 'https://www.threads.net/@seller', 'Threads 個人頁面'],
    ] as const)('renders a canonical %s profile link', async (contactType, contactValue, label) => {
      repositories.getPublicSellerProfile.mockResolvedValue({
        ...seller,
        contactType,
        contactValue,
      });

      render(<ListingPage id="listing-1" />);

      const link = await screen.findByRole('link', { name: label });
      expect(link.getAttribute('href')).toBe(contactValue);
    });

    it.each([
      ['threads', '@legacy'],
      ['facebook', 'javascript:alert(1)'],
    ] as const)('keeps an invalid legacy %s contact non-interactive', async (contactType, contactValue) => {
      repositories.getPublicSellerProfile.mockResolvedValue({
        ...seller,
        contactType,
        contactValue,
      });

      render(<ListingPage id="listing-1" />);

      expect(await screen.findByText('聯絡方式需要由賣家更新')).toBeTruthy();
      expect(screen.queryByRole('link', { name: '聯絡方式需要由賣家更新' })).toBeNull();
      expect([...document.querySelectorAll('a')].some((link) => link.getAttribute('href') === contactValue)).toBe(false);
    });
  });
});
