// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationSubscription } from '../../domain/models';
import { SellerSubscriptionControl } from './SellerSubscriptionControl';

const authState = vi.hoisted(() => ({
  current: {
    user: { uid: 'buyer-1', displayName: 'Buyer', photoURL: null } as { uid: string; displayName: string; photoURL: null } | null,
    isLoading: false,
    error: null,
    accountAccessState: { state: 'active', access: null } as Record<string, unknown>,
    isActiveAccount: true,
    signIn: vi.fn(),
    signOut: vi.fn(),
  },
}));

const subscriptions = vi.hoisted(() => ({
  addNotificationSeller: vi.fn(),
  getNotificationSubscription: vi.fn(),
  removeNotificationSeller: vi.fn(),
}));

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => authState.current }));
vi.mock('../../data/firestore/repositories', () => subscriptions);

afterEach(cleanup);

function saved(sellerIds: string[], uid = 'buyer-1'): NotificationSubscription {
  return {
    uid,
    cardNames: [],
    sellerSubscriptions: sellerIds.map((sellerId, index) => ({
      sellerId,
      followedAt: new Date(`2026-08-25T00:00:0${index}.000Z`),
    })),
    emailDailyEnabled: true,
    updatedAt: new Date('2026-08-25T00:00:00.000Z'),
  };
}

describe('SellerSubscriptionControl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.current.user = { uid: 'buyer-1', displayName: 'Buyer', photoURL: null };
    authState.current.isLoading = false;
    authState.current.accountAccessState = { state: 'active', access: null };
    authState.current.isActiveAccount = true;
    subscriptions.getNotificationSubscription.mockResolvedValue(null);
    subscriptions.addNotificationSeller.mockImplementation(async (uid, sellerId) => saved([sellerId], uid));
    subscriptions.removeNotificationSeller.mockImplementation(async (uid) => saved([], uid));
  });

  it('offers Google sign-in guidance to a guest without loading data', async () => {
    authState.current.user = null;
    const user = userEvent.setup();
    render(<SellerSubscriptionControl sellerId="seller-1" sellerName="毛利小五郎" />);

    await user.click(screen.getByRole('button', { name: '訂閱賣家 毛利小五郎' }));
    expect(screen.getByText('登入後即可訂閱賣家每日摘要')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '使用 Google 登入' }));
    expect(authState.current.signIn).toHaveBeenCalledTimes(1);
    expect(subscriptions.getNotificationSubscription).not.toHaveBeenCalled();
  });

  it('holds a stable loading state, then shows unfollowed and followed states', async () => {
    let resolveRead: ((value: NotificationSubscription | null) => void) | undefined;
    subscriptions.getNotificationSubscription.mockReturnValue(new Promise((resolve) => { resolveRead = resolve; }));
    const view = render(<SellerSubscriptionControl sellerId="seller-1" sellerName="毛利小五郎" />);
    expect(screen.getByText('賣家通知載入中')).toBeTruthy();

    await act(async () => resolveRead?.(null));
    expect(await screen.findByRole('button', { name: '訂閱賣家 毛利小五郎' })).toBeTruthy();

    subscriptions.getNotificationSubscription.mockResolvedValue(saved(['seller-2']));
    view.rerender(<SellerSubscriptionControl sellerId="seller-2" sellerName="灰原哀" />);
    expect(await screen.findByRole('button', { name: '取消訂閱賣家 灰原哀' })).toBeTruthy();
  });

  it('requires daily-email consent and sends exact buyer and seller IDs', async () => {
    const user = userEvent.setup();
    render(<SellerSubscriptionControl sellerId="seller-1" sellerName="毛利小五郎" />);
    await user.click(await screen.findByRole('button', { name: '訂閱賣家 毛利小五郎' }));

    expect(screen.getByText('寄送至你的 Google 登入信箱（已驗證）')).toBeTruthy();
    const confirm = screen.getByRole('button', { name: '確認訂閱' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.click(screen.getByRole('checkbox', { name: '以 Google 登入信箱接收每日摘要' }));
    await user.click(confirm);

    await waitFor(() => expect(subscriptions.addNotificationSeller)
      .toHaveBeenCalledWith('buyer-1', 'seller-1'));
    expect(await screen.findByRole('button', { name: '取消訂閱賣家 毛利小五郎' })).toBeTruthy();
  });

  it('removes the exact followed seller', async () => {
    subscriptions.getNotificationSubscription.mockResolvedValue(saved(['seller-1']));
    const user = userEvent.setup();
    render(<SellerSubscriptionControl sellerId="seller-1" sellerName="毛利小五郎" />);
    await user.click(await screen.findByRole('button', { name: '取消訂閱賣家 毛利小五郎' }));
    await waitFor(() => expect(subscriptions.removeNotificationSeller)
      .toHaveBeenCalledWith('buyer-1', 'seller-1'));
  });

  it('keeps mutations single-flight while saving', async () => {
    let resolveSave: ((value: NotificationSubscription) => void) | undefined;
    subscriptions.addNotificationSeller.mockReturnValue(new Promise((resolve) => { resolveSave = resolve; }));
    const user = userEvent.setup();
    render(<SellerSubscriptionControl sellerId="seller-1" sellerName="毛利小五郎" />);
    await user.click(await screen.findByRole('button', { name: '訂閱賣家 毛利小五郎' }));
    await user.click(screen.getByRole('checkbox'));
    const confirm = screen.getByRole('button', { name: '確認訂閱' });
    await user.dblClick(confirm);
    expect(subscriptions.addNotificationSeller).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('button', { name: '儲存中' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => resolveSave?.(saved(['seller-1'])));
  });

  it('shows generic load and save failures without changing the prior state', async () => {
    subscriptions.getNotificationSubscription.mockRejectedValueOnce(new Error('private load'));
    const first = render(<SellerSubscriptionControl sellerId="seller-1" sellerName="毛利小五郎" />);
    expect((await screen.findByRole('alert')).textContent).toBe('無法讀取賣家通知，請稍後再試。');
    first.unmount();

    subscriptions.getNotificationSubscription.mockResolvedValueOnce(null);
    subscriptions.addNotificationSeller.mockRejectedValueOnce(new Error('private save'));
    const user = userEvent.setup();
    render(<SellerSubscriptionControl sellerId="seller-1" sellerName="毛利小五郎" />);
    await user.click(await screen.findByRole('button', { name: '訂閱賣家 毛利小五郎' }));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: '確認訂閱' }));
    expect((await screen.findByRole('alert')).textContent).toBe('無法更新賣家通知，請稍後再試。');
    expect(screen.getByRole('button', { name: '訂閱賣家 毛利小五郎' })).toBeTruthy();
  });

  it('returns focus to the action when confirmation is cancelled', async () => {
    const user = userEvent.setup();
    render(<SellerSubscriptionControl sellerId="seller-1" sellerName="毛利小五郎" />);
    const action = await screen.findByRole('button', { name: '訂閱賣家 毛利小五郎' });
    await user.click(action);
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('heading', { name: '訂閱賣家每日摘要' })).toBeNull();
    expect(document.activeElement).toBe(action);
  });

  it.each([
    ['suspended', { state: 'suspended', access: {} }],
    ['unavailable', { state: 'unavailable', message: '請重新整理。' }],
  ])('shows guidance and no mutations for %s accounts', (_label, state) => {
    authState.current.accountAccessState = state;
    authState.current.isActiveAccount = false;
    render(<SellerSubscriptionControl sellerId="seller-1" sellerName="毛利小五郎" />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(subscriptions.getNotificationSubscription).not.toHaveBeenCalled();
  });

  it('renders no control when the buyer is the seller', () => {
    authState.current.user = { uid: 'seller-1', displayName: 'Owner', photoURL: null };
    render(<SellerSubscriptionControl sellerId="seller-1" sellerName="Owner" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(subscriptions.getNotificationSubscription).not.toHaveBeenCalled();
  });

  it('ignores stale reads and saves after the listing seller or account changes', async () => {
    let resolveRead: ((value: NotificationSubscription | null) => void) | undefined;
    subscriptions.getNotificationSubscription.mockReturnValueOnce(new Promise((resolve) => { resolveRead = resolve; }));
    const view = render(<SellerSubscriptionControl sellerId="seller-1" sellerName="賣家一" />);
    subscriptions.getNotificationSubscription.mockResolvedValueOnce(null);
    view.rerender(<SellerSubscriptionControl sellerId="seller-2" sellerName="賣家二" />);
    expect(await screen.findByRole('button', { name: '訂閱賣家 賣家二' })).toBeTruthy();
    await act(async () => resolveRead?.(saved(['seller-1'])));
    expect(screen.getByRole('button', { name: '訂閱賣家 賣家二' })).toBeTruthy();

    let resolveSave: ((value: NotificationSubscription) => void) | undefined;
    subscriptions.addNotificationSeller.mockReturnValueOnce(new Promise((resolve) => { resolveSave = resolve; }));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '訂閱賣家 賣家二' }));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: '確認訂閱' }));
    authState.current.user = { uid: 'buyer-2', displayName: 'Buyer 2', photoURL: null };
    subscriptions.getNotificationSubscription.mockResolvedValueOnce(null);
    view.rerender(<SellerSubscriptionControl sellerId="seller-2" sellerName="賣家二" />);
    expect(await screen.findByRole('button', { name: '訂閱賣家 賣家二' })).toBeTruthy();
    await act(async () => resolveSave?.(saved(['seller-2'])));
    expect(screen.getByRole('button', { name: '訂閱賣家 賣家二' })).toBeTruthy();
  });
});
