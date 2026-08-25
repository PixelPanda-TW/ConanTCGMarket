// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationSubscription } from '../../domain/models';
import { NotificationSettingsPage } from './NotificationSettingsPage';

const authState = vi.hoisted(() => ({
  current: {
    user: { uid: 'buyer-1', displayName: 'Buyer', photoURL: null } as { uid: string; displayName: string; photoURL: null } | null,
    isLoading: false,
    error: null,
    signIn: vi.fn(),
    signOut: vi.fn(),
  },
}));

const subscriptions = vi.hoisted(() => ({
  getNotificationSubscription: vi.fn(),
  saveNotificationSubscription: vi.fn(),
}));

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => authState.current,
}));

vi.mock('../../data/firestore/repositories', () => subscriptions);

const savedSubscription: NotificationSubscription = {
  uid: 'buyer-1',
  characterKeys: ['諸伏景光', '安室透'],
  emailDailyEnabled: true,
  updatedAt: new Date('2026-08-25T00:00:00.000Z'),
};

afterEach(cleanup);

describe('NotificationSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.current.user = { uid: 'buyer-1', displayName: 'Buyer', photoURL: null };
    subscriptions.getNotificationSubscription.mockResolvedValue(savedSubscription);
    subscriptions.saveNotificationSubscription.mockResolvedValue(undefined);
  });

  it('removes a subscribed character and persists the remaining settings', async () => {
    const user = userEvent.setup();
    render(<NotificationSettingsPage />);

    await user.click(await screen.findByRole('button', { name: '移除諸伏景光通知' }));

    await waitFor(() => expect(subscriptions.saveNotificationSubscription).toHaveBeenCalledWith(expect.objectContaining({
      uid: 'buyer-1',
      characterKeys: ['安室透'],
      emailDailyEnabled: true,
      updatedAt: expect.any(Date),
    })));
    expect(screen.queryByText('諸伏景光')).toBeNull();
  });

  it('toggles and persists the daily email preference', async () => {
    const user = userEvent.setup();
    render(<NotificationSettingsPage />);

    const checkbox = await screen.findByRole('checkbox', { name: '每日彙整 Email 通知' });
    expect((checkbox as HTMLInputElement).checked).toBe(true);
    await user.click(checkbox);

    await waitFor(() => expect(subscriptions.saveNotificationSubscription).toHaveBeenCalledWith(expect.objectContaining({
      characterKeys: ['諸伏景光', '安室透'],
      emailDailyEnabled: false,
    })));
    expect((checkbox as HTMLInputElement).checked).toBe(false);
  });

  it('explains that Discord is a public all-listings feed without account linking', async () => {
    render(<NotificationSettingsPage />);

    expect(await screen.findByText('Discord 公開頻道會提供所有上架商品通知，不需綁定帳號。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Discord/ })).toBeNull();
  });

  it('shows a loading state while settings are being fetched', () => {
    subscriptions.getNotificationSubscription.mockReturnValue(new Promise(() => undefined));

    render(<NotificationSettingsPage />);

    expect(screen.getByText('通知設定載入中')).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: '每日彙整 Email 通知' })).toBeNull();
    expect(screen.queryByRole('button', { name: /移除.*通知/ })).toBeNull();
    expect(subscriptions.saveNotificationSubscription).not.toHaveBeenCalled();
  });

  it('starts a signed-in render in loading state before the settings effect runs', () => {
    const markup = renderToStaticMarkup(<NotificationSettingsPage />);

    expect(markup).toContain('通知設定載入中');
    expect(markup).not.toContain('每日彙整 Email 通知');
    expect(markup).not.toContain('尚未訂閱任何角色');
  });

  it('shows an error state when settings cannot be loaded', async () => {
    subscriptions.getNotificationSubscription.mockRejectedValue(new Error('read failed'));

    render(<NotificationSettingsPage />);

    expect((await screen.findByRole('alert')).textContent).toBe('無法載入通知設定，請稍後再試。');
  });

  it('does not expose completed changes from a previous authenticated buyer', async () => {
    let finishSave: (() => void) | undefined;
    subscriptions.saveNotificationSubscription.mockReturnValue(new Promise<void>((resolve) => {
      finishSave = resolve;
    }));
    const user = userEvent.setup();
    const view = render(<NotificationSettingsPage />);

    await user.click(await screen.findByRole('button', { name: '移除諸伏景光通知' }));
    authState.current.user = { uid: 'buyer-2', displayName: 'Second buyer', photoURL: null };
    subscriptions.getNotificationSubscription.mockResolvedValueOnce({
      uid: 'buyer-2',
      characterKeys: ['赤井秀一'],
      emailDailyEnabled: false,
      updatedAt: new Date('2026-08-25T01:00:00.000Z'),
    });
    view.rerender(<NotificationSettingsPage />);

    expect(await screen.findByText('赤井秀一')).toBeTruthy();
    await act(async () => finishSave?.());
    expect(screen.getByText('赤井秀一')).toBeTruthy();
    expect(screen.queryByText('安室透')).toBeNull();
  });
});
