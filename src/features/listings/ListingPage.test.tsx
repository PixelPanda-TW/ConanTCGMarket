// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card, Listing, PublicSellerProfile } from '../../domain/models';
import { ListingPage } from './ListingPage';

const repositories = vi.hoisted(() => ({
  addNotificationCardName: vi.fn(),
  addNotificationSeller: vi.fn(),
  getListing: vi.fn(),
  getNotificationSubscription: vi.fn(),
  getPublicSellerProfile: vi.fn(),
  getSellerContact: vi.fn(),
  listCards: vi.fn(),
  removeNotificationCardName: vi.fn(),
  removeNotificationSeller: vi.fn(),
  republishSuspendedListing: vi.fn(),
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
const seller: PublicSellerProfile = {
  uid: 'seller-1',
  displayName: 'Seller',
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
    repositories.addNotificationSeller.mockResolvedValue({
      uid: 'buyer-1', cardNames: [],
      sellerSubscriptions: [{ sellerId: 'seller-1', followedAt: new Date() }],
      emailDailyEnabled: true, updatedAt: new Date(),
    });
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

  it('connects an active non-owner Listing seller identity to seller subscription', async () => {
    authState.current.user = { uid: 'buyer-1' };
    authState.current.accountAccessState = { state: 'active', access: null };
    authState.current.isActiveAccount = true;
    const user = userEvent.setup();
    render(<ListingPage id="listing-1" />);

    await user.click(await screen.findByRole('button', { name: '訂閱賣家 Seller' }));
    await user.click(screen.getByRole('checkbox', { name: '以 Google 登入信箱接收每日摘要' }));
    await user.click(screen.getByRole('button', { name: '確認訂閱' }));

    await waitFor(() => expect(repositories.addNotificationSeller)
      .toHaveBeenCalledWith('buyer-1', 'seller-1'));
  });

  it('offers report navigation to active non-owners and guests with Listing continuity', async () => {
    const view = render(<ListingPage id="listing-1" />);
    expect(await screen.findByRole('link', { name: '檢舉商品' })).toHaveProperty(
      'href', expect.stringContaining('#/listing/listing-1/report'),
    );

    authState.current.user = { uid: 'buyer-1' };
    authState.current.accountAccessState = { state: 'active', access: null };
    authState.current.isActiveAccount = true;
    view.rerender(<ListingPage id="listing-1" />);
    expect(await screen.findByRole('link', { name: '檢舉商品' })).toBeTruthy();
  });

  it('hides report navigation from owners, sold Listings, and unavailable accounts', async () => {
    authState.current.user = { uid: 'seller-1' };
    authState.current.accountAccessState = { state: 'active', access: null };
    authState.current.isActiveAccount = true;
    const view = render(<ListingPage id="listing-1" />);
    await screen.findByText('Seller');
    expect(screen.queryByRole('link', { name: '檢舉商品' })).toBeNull();

    authState.current.user = { uid: 'buyer-1' };
    authState.current.accountAccessState = { state: 'unavailable' };
    authState.current.isActiveAccount = false;
    view.rerender(<ListingPage id="listing-1" />);
    expect(screen.queryByRole('link', { name: '檢舉商品' })).toBeNull();

    repositories.getListing.mockResolvedValue({ ...listing, status: 'sold_out', remainingQuantity: 0 });
    authState.current.user = { uid: 'seller-1' };
    authState.current.accountAccessState = { state: 'active', access: null };
    authState.current.isActiveAccount = true;
    view.rerender(<ListingPage id="listing-sold" />);
    await screen.findByText('已售罄');
    expect(screen.queryByRole('link', { name: '檢舉商品' })).toBeNull();
  });

  it('does not expose seller subscription mutation for owner or suspended buyer', async () => {
    authState.current.user = { uid: 'seller-1' };
    authState.current.accountAccessState = { state: 'active', access: null };
    authState.current.isActiveAccount = true;
    const view = render(<ListingPage id="listing-1" />);
    await screen.findByText('Seller');
    expect(screen.queryByRole('button', { name: /訂閱賣家/u })).toBeNull();

    authState.current.user = { uid: 'buyer-1' };
    authState.current.accountAccessState = { state: 'suspended', access: {} };
    authState.current.isActiveAccount = false;
    view.rerender(<ListingPage id="listing-1" />);
    expect(screen.queryByRole('button', { name: /訂閱賣家/u })).toBeNull();
    expect(repositories.addNotificationSeller).not.toHaveBeenCalled();
  });

  it('keeps a sold-out Listing visible only to its owner and removes every action', async () => {
    repositories.getListing.mockResolvedValue({
      ...listing, status: 'sold_out', remainingQuantity: 0,
    });
    authState.current.user = { uid: 'seller-1' };
    authState.current.accountAccessState = { state: 'active', access: null };
    authState.current.isActiveAccount = true;

    const view = render(<ListingPage id="listing-1" />);
    expect(await screen.findByRole('heading', { name: '商品詳情' })).toBeTruthy();
    expect(screen.getByText('已售罄')).toBeTruthy();
    expect(screen.queryByRole('link', { name: '管理此商品' })).toBeNull();
    expect(screen.queryByRole('button', { name: /訂閱|查看聯絡方式/ })).toBeNull();

    authState.current.user = null;
    authState.current.accountAccessState = { state: 'signed-out' };
    authState.current.isActiveAccount = false;
    view.rerender(<ListingPage id="listing-1" />);
    expect(await screen.findByRole('heading', { name: '找不到商品' })).toBeTruthy();
  });

  it('shows a held Listing only to its owner and gates every mutation by active access', async () => {
    const held = {
      ...listing, status: 'suspended' as const, suspensionActionId: 'a'.repeat(64),
      suspendedAt: new Date('2026-09-04T06:00:00Z'),
    };
    repositories.getListing.mockResolvedValue(held);
    authState.current.user = { uid: 'seller-1' };
    authState.current.accountAccessState = { state: 'suspended', access: {} };
    const view = render(<ListingPage id="listing-1" />);
    expect(await screen.findByText('因帳號停權暫停顯示')).toBeTruthy();
    expect(screen.queryByRole('link', { name: '管理此商品' })).toBeNull();
    expect(screen.queryByRole('button', { name: '重新上架商品' })).toBeNull();
    expect(screen.queryByRole('button', { name: /查看聯絡方式|訂閱/u })).toBeNull();

    authState.current.accountAccessState = { state: 'active', access: null };
    authState.current.isActiveAccount = true;
    view.rerender(<ListingPage id="listing-1" />);
    expect(screen.getByRole('link', { name: '管理此商品' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '重新上架商品' })).toBeTruthy();

    authState.current.user = { uid: 'buyer-1' };
    view.rerender(<ListingPage id="listing-1" />);
    expect(await screen.findByRole('heading', { name: '找不到商品' })).toBeTruthy();
  });

  it('republishes a held Listing once, waits for trusted reload, and sanitizes retry errors', async () => {
    const held = {
      ...listing, status: 'suspended' as const, suspensionActionId: 'a'.repeat(64),
      suspendedAt: new Date('2026-09-04T06:00:00Z'),
    };
    repositories.getListing.mockResolvedValueOnce(held).mockResolvedValueOnce(listing);
    authState.current.user = { uid: 'seller-1' };
    authState.current.accountAccessState = { state: 'active', access: null };
    authState.current.isActiveAccount = true;
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    let resolveRepublish!: (value: unknown) => void;
    repositories.republishSuspendedListing
      .mockRejectedValueOnce(new Error('private operation'))
      .mockReturnValueOnce(new Promise((resolve) => { resolveRepublish = resolve; }));
    render(<ListingPage id="listing-1" />);
    const action = await screen.findByRole('button', { name: '重新上架商品' });
    fireEvent.click(action);
    expect((await screen.findByRole('alert')).textContent).toContain('無法重新上架商品');
    expect(document.body.textContent).not.toContain('private operation');
    fireEvent.click(screen.getByRole('button', { name: '重新上架商品' }));
    fireEvent.click(screen.getByRole('button', { name: '重新上架處理中' }));
    expect(repositories.republishSuspendedListing).toHaveBeenCalledTimes(2);
    expect(repositories.republishSuspendedListing).toHaveBeenLastCalledWith({
      listingId: 'listing-1', suspensionActionId: 'a'.repeat(64),
    });
    expect(screen.getByText('因帳號停權暫停顯示')).toBeTruthy();
    resolveRepublish({ listingId: 'listing-1', status: 'active', updatedAt: new Date() });
    expect(await screen.findByText('商品已重新上架。')).toBeTruthy();
    expect(repositories.getListing).toHaveBeenCalledTimes(2);
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
    expect(document.querySelector('.card-name-subscription-control')).toBeNull();
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
    expect(document.querySelector('.card-name-subscription-control')).toBeNull();
  });

  describe('protected seller contact disclosure', () => {
    function activate(uid = 'buyer-1') {
      authState.current.user = { uid };
      authState.current.accountAccessState = { state: 'active', access: null };
      authState.current.isActiveAccount = true;
    }

    it('loads public seller presentation without requesting or rendering contact', async () => {
      render(<ListingPage id="listing-1" />);
      expect(await screen.findByText('Seller')).toBeTruthy();
      expect(screen.getByRole('button', { name: '登入後查看聯絡方式' })).toBeTruthy();
      expect(repositories.getSellerContact).not.toHaveBeenCalled();
      expect(document.body.textContent).not.toContain('@seller');
    });

    it('uses existing Google sign-in and preserves the Listing route', async () => {
      window.location.hash = '#/listing/listing-1';
      render(<ListingPage id="listing-1" />);
      await screen.findByText('Seller');
      fireEvent.click(screen.getByRole('button', { name: '登入後查看聯絡方式' }));
      expect(authState.current.signIn).toHaveBeenCalledTimes(1);
      expect(window.location.hash).toBe('#/listing/listing-1');
      expect(repositories.getSellerContact).not.toHaveBeenCalled();
    });

    it.each([
      ['line', '@seller', 'LINE ID：@seller', 'https://line.me/ti/p/~%40seller'],
      ['discord', 'seller_name', 'Discord ID：seller_name', null],
      ['facebook', 'https://www.facebook.com/seller', 'Facebook 個人頁面', 'https://www.facebook.com/seller'],
      ['threads', 'https://www.threads.net/@seller', 'Threads 個人頁面', 'https://www.threads.net/@seller'],
    ] as const)('reveals canonical %s only after an active user clicks', async (contactType, contactValue, label, href) => {
      activate();
      repositories.getSellerContact.mockResolvedValue({ contactType, contactValue });
      render(<ListingPage id="listing-1" />);
      const button = await screen.findByRole('button', { name: '查看聯絡方式' });
      expect(screen.queryByText(label)).toBeNull();
      fireEvent.click(button);

      const rendered = await screen.findByText(label);
      expect(repositories.getSellerContact).toHaveBeenCalledWith('listing-1');
      if (href) {
        expect(rendered.closest('a')?.getAttribute('href')).toBe(href);
      } else {
        expect(rendered.closest('a')).toBeNull();
      }
    });

    it('disables duplicate requests while a reveal is pending', async () => {
      activate();
      repositories.getSellerContact.mockReturnValue(new Promise(() => undefined));
      render(<ListingPage id="listing-1" />);
      const button = await screen.findByRole('button', { name: '查看聯絡方式' });
      fireEvent.click(button);
      expect((await screen.findByRole('button', { name: '讀取聯絡方式中' })).hasAttribute('disabled')).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: '讀取聯絡方式中' }));
      expect(repositories.getSellerContact).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['suspended', { state: 'suspended', access: { uid: 'buyer-1', status: 'suspended' } }],
      ['unavailable', { state: 'unavailable', message: '請重新整理。' }],
      ['loading', { state: 'loading' }],
    ])('does not expose a callable trigger while account state is %s', async (_name, accountAccessState) => {
      authState.current.user = { uid: 'buyer-1' };
      authState.current.accountAccessState = accountAccessState;
      authState.current.isActiveAccount = false;
      render(<ListingPage id="listing-1" />);
      await screen.findByText('Seller');
      expect(screen.queryByRole('button', { name: /查看聯絡方式/ })).toBeNull();
      expect(repositories.getSellerContact).not.toHaveBeenCalled();
    });

    it.each([
      ['generic', new Error('network'), '目前無法讀取聯絡方式，請稍後再試。'],
      ['rate limit', { code: 'functions/resource-exhausted' }, '本時段查看次數已達上限，請稍後再試。'],
    ])('shows a contact-free retry state for %s failure', async (_name, error, message) => {
      activate();
      repositories.getSellerContact.mockRejectedValue(error);
      render(<ListingPage id="listing-1" />);
      fireEvent.click(await screen.findByRole('button', { name: '查看聯絡方式' }));
      expect((await screen.findByRole('alert')).textContent).toBe(message);
      expect(screen.getByRole('button', { name: '重新查看聯絡方式' })).toBeTruthy();
      expect(document.body.textContent).not.toContain('@seller');
    });

    it('drops a stale reveal when the authenticated UID changes', async () => {
      activate('buyer-1');
      let resolveContact!: (value: unknown) => void;
      repositories.getSellerContact.mockReturnValue(new Promise((resolve) => { resolveContact = resolve; }));
      const view = render(<ListingPage id="listing-1" />);
      fireEvent.click(await screen.findByRole('button', { name: '查看聯絡方式' }));

      activate('buyer-2');
      view.rerender(<ListingPage id="listing-1" />);
      resolveContact({ contactType: 'line', contactValue: '@seller' });
      await waitFor(() => expect(screen.getByRole('button', { name: '查看聯絡方式' })).toBeTruthy());
      expect(screen.queryByText('LINE ID：@seller')).toBeNull();
    });

    it('clears a revealed contact immediately when navigating to another Listing', async () => {
      activate();
      repositories.getSellerContact.mockResolvedValue({ contactType: 'discord', contactValue: 'seller_name' });
      const view = render(<ListingPage id="listing-1" />);
      fireEvent.click(await screen.findByRole('button', { name: '查看聯絡方式' }));
      expect(await screen.findByText('Discord ID：seller_name')).toBeTruthy();
      repositories.getListing.mockResolvedValue({ ...listing, id: 'listing-2' });

      view.rerender(<ListingPage id="listing-2" />);
      expect(screen.queryByText('Discord ID：seller_name')).toBeNull();
    });
  });
});
