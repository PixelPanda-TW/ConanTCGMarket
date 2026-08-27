// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { Profiler } from 'react';
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
  cardNames: ['洗牌情緣', '江戶川柯南'],
  emailDailyEnabled: true,
  updatedAt: new Date('2026-08-27T00:00:00.000Z'),
};

afterEach(cleanup);

describe('NotificationSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.current.user = { uid: 'buyer-1', displayName: 'Buyer', photoURL: null };
    authState.current.isLoading = false;
    subscriptions.getNotificationSubscription.mockResolvedValue(savedSubscription);
    subscriptions.saveNotificationSubscription.mockResolvedValue(undefined);
  });

  it('presents raw card names in zh-Hant order without mutating persisted order', async () => {
    render(<NotificationSettingsPage />);

    expect(await screen.findByRole('heading', { name: '我的訂閱' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^移除.+訂閱$/ }).map((button) => button.getAttribute('aria-label'))).toEqual([
      '移除江戶川柯南訂閱',
      '移除洗牌情緣訂閱',
    ]);
    expect(savedSubscription.cardNames).toEqual(['洗牌情緣', '江戶川柯南']);
  });

  it('removes an exact card name from the original persisted order', async () => {
    const user = userEvent.setup();
    render(<NotificationSettingsPage />);

    await user.click(await screen.findByRole('button', { name: '移除江戶川柯南訂閱' }));

    await waitFor(() => expect(subscriptions.saveNotificationSubscription).toHaveBeenCalledWith(expect.objectContaining({
      uid: 'buyer-1',
      cardNames: ['洗牌情緣'],
      emailDailyEnabled: true,
      updatedAt: expect.any(Date),
    })));
    expect(screen.queryByText('江戶川柯南')).toBeNull();
  });

  it('removes the final card name and shows the empty state', async () => {
    subscriptions.getNotificationSubscription.mockResolvedValue({
      ...savedSubscription,
      cardNames: ['江戶川柯南'],
    });
    const user = userEvent.setup();
    render(<NotificationSettingsPage />);

    await user.click(await screen.findByRole('button', { name: '移除江戶川柯南訂閱' }));

    await waitFor(() => expect(subscriptions.saveNotificationSubscription).toHaveBeenCalledWith(expect.objectContaining({
      cardNames: [],
    })));
    expect(screen.getByText('尚未訂閱任何卡名。')).toBeTruthy();
  });

  it('toggles the daily email preference while preserving every raw card name', async () => {
    const user = userEvent.setup();
    render(<NotificationSettingsPage />);

    const checkbox = await screen.findByRole('checkbox', { name: '每日彙整 Email 通知' });
    expect((checkbox as HTMLInputElement).checked).toBe(true);
    await user.click(checkbox);

    await waitFor(() => expect(subscriptions.saveNotificationSubscription).toHaveBeenCalledWith(expect.objectContaining({
      cardNames: ['洗牌情緣', '江戶川柯南'],
      emailDailyEnabled: false,
    })));
    expect((checkbox as HTMLInputElement).checked).toBe(false);
  });

  it('shows Google sign-in guidance when signed out', async () => {
    authState.current.user = null;
    const user = userEvent.setup();
    render(<NotificationSettingsPage />);

    expect(screen.getByText('請先使用 Google 登入，才能管理卡名訂閱。')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '使用 Google 登入' }));
    expect(authState.current.signIn).toHaveBeenCalledTimes(1);
    expect(subscriptions.getNotificationSubscription).not.toHaveBeenCalled();
  });

  it('shows a loading status while auth is resolving', () => {
    authState.current.isLoading = true;

    render(<NotificationSettingsPage />);

    expect(screen.getByRole('status').textContent).toBe('登入狀態確認中');
    expect(subscriptions.getNotificationSubscription).not.toHaveBeenCalled();
  });

  it('keeps management controls hidden while the subscription is loading', () => {
    subscriptions.getNotificationSubscription.mockReturnValue(new Promise(() => undefined));

    render(<NotificationSettingsPage />);

    expect(screen.getByRole('status').textContent).toBe('我的訂閱載入中');
    expect(screen.queryByRole('checkbox', { name: '每日彙整 Email 通知' })).toBeNull();
    expect(screen.queryByRole('button', { name: /移除.*訂閱/ })).toBeNull();
    expect(subscriptions.saveNotificationSubscription).not.toHaveBeenCalled();
  });

  it('starts a signed-in server render in loading state before the subscription effect runs', () => {
    const markup = renderToStaticMarkup(<NotificationSettingsPage />);

    expect(markup).toContain('我的訂閱載入中');
    expect(markup).not.toContain('每日彙整 Email 通知');
    expect(markup).not.toContain('尚未訂閱任何卡名');
  });

  it('shows an alert when the subscription cannot be loaded', async () => {
    subscriptions.getNotificationSubscription.mockRejectedValue(new Error('read failed'));

    render(<NotificationSettingsPage />);

    expect((await screen.findByRole('alert')).textContent).toBe('無法載入訂閱，請稍後再試。');
  });

  it('disables every mutation control and announces a pending save', async () => {
    subscriptions.saveNotificationSubscription.mockReturnValue(new Promise(() => undefined));
    const user = userEvent.setup();
    render(<NotificationSettingsPage />);

    await user.click(await screen.findByRole('button', { name: '移除江戶川柯南訂閱' }));

    expect(screen.getByRole('status').textContent).toBe('訂閱儲存中');
    expect(screen.getAllByRole('button', { name: /移除.*訂閱/ }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    expect((screen.getByRole('checkbox', { name: '每日彙整 Email 通知' }) as HTMLInputElement).disabled).toBe(true);
  });

  it('announces a failed save, retains the prior names, and re-enables controls', async () => {
    subscriptions.saveNotificationSubscription.mockRejectedValue(new Error('write failed'));
    const user = userEvent.setup();
    render(<NotificationSettingsPage />);

    await user.click(await screen.findByRole('button', { name: '移除江戶川柯南訂閱' }));

    expect((await screen.findByRole('alert')).textContent).toBe('無法儲存訂閱，請稍後再試。');
    expect(screen.getByText('江戶川柯南')).toBeTruthy();
    expect((screen.getByRole('button', { name: '移除江戶川柯南訂閱' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('never commits subscription names from a previous authenticated buyer', async () => {
    const committedText: string[] = [];
    const page = () => (
      <Profiler id="subscription-management" onRender={() => committedText.push(document.body.textContent ?? '')}>
        <NotificationSettingsPage />
      </Profiler>
    );
    const view = render(page());
    expect(await screen.findByText('江戶川柯南')).toBeTruthy();
    committedText.length = 0;

    authState.current.user = { uid: 'buyer-2', displayName: 'Second buyer', photoURL: null };
    subscriptions.getNotificationSubscription.mockResolvedValueOnce({
      uid: 'buyer-2',
      cardNames: ['赤井秀一'],
      emailDailyEnabled: false,
      updatedAt: new Date('2026-08-27T01:00:00.000Z'),
    });
    view.rerender(page());

    expect(await screen.findByText('赤井秀一')).toBeTruthy();
    expect(committedText.length).toBeGreaterThan(0);
    expect(committedText.every((text) => !text.includes('江戶川柯南') && !text.includes('洗牌情緣'))).toBe(true);
  });

  it('does not expose a completed save from a previous authenticated buyer', async () => {
    let finishSave: (() => void) | undefined;
    subscriptions.saveNotificationSubscription.mockReturnValue(new Promise<void>((resolve) => {
      finishSave = resolve;
    }));
    const user = userEvent.setup();
    const view = render(<NotificationSettingsPage />);

    await user.click(await screen.findByRole('button', { name: '移除江戶川柯南訂閱' }));
    authState.current.user = { uid: 'buyer-2', displayName: 'Second buyer', photoURL: null };
    subscriptions.getNotificationSubscription.mockResolvedValueOnce({
      uid: 'buyer-2',
      cardNames: ['赤井秀一'],
      emailDailyEnabled: false,
      updatedAt: new Date('2026-08-27T01:00:00.000Z'),
    });
    view.rerender(<NotificationSettingsPage />);

    expect(await screen.findByText('赤井秀一')).toBeTruthy();
    expect((screen.getByRole('button', { name: '移除赤井秀一訂閱' }) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => finishSave?.());
    expect(screen.getByText('赤井秀一')).toBeTruthy();
    expect(screen.queryByText('洗牌情緣')).toBeNull();
  });

  it('does not present Discord delivery before Discord account linking is supported', async () => {
    render(<NotificationSettingsPage />);

    await screen.findByRole('checkbox', { name: '每日彙整 Email 通知' });
    expect(screen.queryByText(/Discord/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Discord/ })).toBeNull();
  });

  it('uses generic responsive card-name styles and accessible interaction tokens', () => {
    const styles = readFileSync('src/styles.css', 'utf8');

    expect(styles).toMatch(/\.subscribed-card-name-list\s*\{/);
    expect(styles).not.toMatch(/\.subscribed-character-list/);
    expect(styles).toMatch(/\.notification-settings-card button:focus-visible\s*\{[^}]*outline: 3px solid hsl\(var\(--ring\)\);/s);
    expect(styles).toMatch(/\.notification-sign-in-guidance button\s*\{[^}]*min-height: 44px;/s);
    expect(styles).toMatch(/\.notification-sign-in-guidance button:focus-visible\s*\{[^}]*outline: 3px solid hsl\(var\(--ring\)\);/s);
    expect(styles).toMatch(/\.subscribed-card-name-list button\s*\{[^}]*color: hsl\(var\(--destructive\)\);/s);
    expect(styles).toMatch(/@media \(max-width: 640px\)\s*\{[\s\S]*\.subscribed-card-name-list li,[\s\S]*\.subscribed-card-name-list button\s*\{[^}]*width: 100%;/s);
  });
});
