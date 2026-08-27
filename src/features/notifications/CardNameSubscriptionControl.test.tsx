// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Profiler, startTransition, Suspense } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationSubscription } from '../../domain/models';
import { CardNameSubscriptionControl } from './CardNameSubscriptionControl';

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

afterEach(cleanup);

function savedSubscription(cardNames: string[]): NotificationSubscription {
  return {
    uid: 'buyer-1',
    cardNames,
    emailDailyEnabled: true,
    updatedAt: new Date('2026-08-25T00:00:00.000Z'),
  };
}

describe('CardNameSubscriptionControl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.current.user = { uid: 'buyer-1', displayName: 'Buyer', photoURL: null };
    authState.current.isLoading = false;
    subscriptions.getNotificationSubscription.mockResolvedValue(null);
    subscriptions.saveNotificationSubscription.mockResolvedValue(undefined);
  });

  it('uses the theme ring and background separation for subscription focus indicators', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

    expect(styles).toMatch(/\.card-name-subscription-control button:focus-visible,\s*\.subscription-management-link:focus-visible\s*\{[^}]*outline: 3px solid hsl\(var\(--ring\)\);/s);
    expect(styles).toMatch(/\.card-name-subscription-control button:focus-visible,\s*\.subscription-management-link:focus-visible\s*\{[^}]*box-shadow: 0 0 0 2px hsl\(var\(--background\)\);/s);
    expect(styles).not.toMatch(/\.subscription-feedback:empty\s*\{[^}]*display:\s*none;/s);
  });

  it('offers subscription for a complete known Card Master name', async () => {
    render(<CardNameSubscriptionControl cardName="江戶川柯南" isKnownCardName />);

    expect(await screen.findByRole('button', { name: '訂閱江戶川柯南' })).toBeTruthy();
  });

  it('renders no mutation control for an unknown or incomplete name', () => {
    render(<CardNameSubscriptionControl cardName="江戶川" isKnownCardName={false} />);

    expect(screen.queryByRole('button')).toBeNull();
    expect(subscriptions.getNotificationSubscription).not.toHaveBeenCalled();
  });

  it('sends a signed-out buyer to Google sign-in guidance', async () => {
    authState.current.user = null;
    const user = userEvent.setup();
    render(<CardNameSubscriptionControl cardName="江戶川柯南" isKnownCardName />);

    await user.click(screen.getByRole('button', { name: '訂閱江戶川柯南' }));

    expect(screen.getByText('登入後即可訂閱卡名通知')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '使用 Google 登入' }));
    expect(authState.current.signIn).toHaveBeenCalledTimes(1);
  });

  it('keeps a signed-in read loading until the repository resolves', async () => {
    let finishRead: ((subscription: NotificationSubscription | null) => void) | undefined;
    subscriptions.getNotificationSubscription.mockReturnValue(new Promise((resolve) => {
      finishRead = resolve;
    }));

    const markup = renderToStaticMarkup(
      <CardNameSubscriptionControl cardName="江戶川柯南" isKnownCardName />,
    );
    expect(markup).toContain('卡名通知載入中');
    expect(markup).not.toContain('訂閱江戶川柯南');

    render(<CardNameSubscriptionControl cardName="江戶川柯南" isKnownCardName />);
    expect(screen.getByText('卡名通知載入中')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /訂閱江戶川柯南/ })).toBeNull();

    await act(async () => finishRead?.(savedSubscription(['江戶川柯南'])));
    expect(await screen.findByRole('button', { name: '取消訂閱江戶川柯南' })).toBeTruthy();
  });

  it('requires explicit daily-email confirmation and persists the exact selected Card Master name', async () => {
    const user = userEvent.setup();
    render(<CardNameSubscriptionControl cardName="江戶川柯南" isKnownCardName />);

    await user.click(await screen.findByRole('button', { name: '訂閱江戶川柯南' }));

    expect(await screen.findByRole('heading', { name: '選擇通知方式' })).toBeTruthy();
    expect(screen.getByText('寄送至你的 Google 登入信箱（已驗證）')).toBeTruthy();
    expect(subscriptions.saveNotificationSubscription).not.toHaveBeenCalled();

    const emailDelivery = screen.getByRole('checkbox', { name: '以 Google 登入信箱接收每日摘要' });
    expect((emailDelivery as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('button', { name: '確認訂閱' }) as HTMLButtonElement).disabled).toBe(true);

    await user.click(emailDelivery);
    await user.click(screen.getByRole('button', { name: '確認訂閱' }));

    await waitFor(() => expect(subscriptions.saveNotificationSubscription).toHaveBeenCalledWith(expect.objectContaining({
      uid: 'buyer-1',
      cardNames: ['江戶川柯南'],
      emailDailyEnabled: true,
      updatedAt: expect.any(Date),
    })));
    expect(await screen.findByRole('button', { name: '取消訂閱江戶川柯南' })).toBeTruthy();
  });

  it('shows the unsubscribe state for an exact subscription and removes only that exact name', async () => {
    subscriptions.getNotificationSubscription.mockResolvedValue(savedSubscription(['洗牌情緣', '江戶川柯南']));
    const user = userEvent.setup();
    render(<CardNameSubscriptionControl cardName="江戶川柯南" isKnownCardName />);

    await user.click(await screen.findByRole('button', { name: '取消訂閱江戶川柯南' }));

    await waitFor(() => expect(subscriptions.saveNotificationSubscription).toHaveBeenCalledWith(expect.objectContaining({
      cardNames: ['洗牌情緣'],
      emailDailyEnabled: true,
    })));
    expect(await screen.findByRole('button', { name: '訂閱江戶川柯南' })).toBeTruthy();
  });

  it('announces successful subscription and returns focus to the stable unsubscribe action', async () => {
    const user = userEvent.setup();
    render(<CardNameSubscriptionControl cardName="江戶川柯南" isKnownCardName />);

    await user.click(await screen.findByRole('button', { name: '訂閱江戶川柯南' }));
    await user.click(screen.getByRole('checkbox', { name: '以 Google 登入信箱接收每日摘要' }));
    await user.click(screen.getByRole('button', { name: '確認訂閱' }));

    const success = await screen.findByText('已訂閱「江戶川柯南」的每日摘要通知。');
    expect(success.parentElement?.getAttribute('aria-live')).toBe('polite');
    const unsubscribe = screen.getByRole('button', { name: '取消訂閱江戶川柯南' });
    expect(document.activeElement).toBe(unsubscribe);
  });

  it('announces successful unsubscription and keeps focus on the stable subscribe action', async () => {
    subscriptions.getNotificationSubscription.mockResolvedValue(savedSubscription(['江戶川柯南']));
    const user = userEvent.setup();
    render(<CardNameSubscriptionControl cardName="江戶川柯南" isKnownCardName />);

    await user.click(await screen.findByRole('button', { name: '取消訂閱江戶川柯南' }));

    const success = await screen.findByText('已取消訂閱「江戶川柯南」。');
    expect(success.parentElement?.getAttribute('aria-live')).toBe('polite');
    const subscribe = screen.getByRole('button', { name: '訂閱江戶川柯南' });
    expect(document.activeElement).toBe(subscribe);
  });

  it('announces exact compound unsubscription and focuses management when a shorter name still covers it', async () => {
    subscriptions.getNotificationSubscription.mockResolvedValue(savedSubscription([
      '江戶川柯南',
      '江戶川柯南＆灰原哀',
    ]));
    const user = userEvent.setup();
    render(<CardNameSubscriptionControl cardName="江戶川柯南＆灰原哀" isKnownCardName />);

    await user.click(await screen.findByRole('button', { name: '取消訂閱江戶川柯南＆灰原哀' }));

    const success = await screen.findByText('已取消訂閱「江戶川柯南＆灰原哀」。');
    expect(success.parentElement?.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByText('已由「江戶川柯南」訂閱涵蓋')).toBeTruthy();
    const management = screen.getByRole('link', { name: '管理我的訂閱' });
    expect(document.activeElement).toBe(management);
  });

  it('shows coverage management instead of a misleading subscribe action', async () => {
    subscriptions.getNotificationSubscription.mockResolvedValue(savedSubscription(['江戶川柯南']));
    render(<CardNameSubscriptionControl cardName="江戶川柯南＆灰原哀" isKnownCardName />);

    expect(await screen.findByText('已由「江戶川柯南」訂閱涵蓋')).toBeTruthy();
    expect(screen.getByRole('link', { name: '管理我的訂閱' }).getAttribute('href')).toBe('#/notifications');
    expect(screen.queryByRole('button', { name: /訂閱江戶川柯南＆灰原哀/ })).toBeNull();
  });

  it.each([
    {
      cardName: '江戶川柯南',
      cardNames: ['江戶川柯南'],
      staleText: '取消訂閱江戶川柯南',
    },
    {
      cardName: '江戶川柯南＆灰原哀',
      cardNames: ['江戶川柯南'],
      staleText: '已由「江戶川柯南」訂閱涵蓋',
    },
  ])('never commits previous buyer subscription UI after sign-out: $staleText', async ({ cardName, cardNames, staleText }) => {
    subscriptions.getNotificationSubscription.mockResolvedValue(savedSubscription(cardNames));
    const committedText: string[] = [];
    const control = () => (
      <Profiler id="subscription-control" onRender={() => committedText.push(document.body.textContent ?? '')}>
        <CardNameSubscriptionControl cardName={cardName} isKnownCardName />
      </Profiler>
    );
    const view = render(control());
    expect(await screen.findByText(staleText)).toBeTruthy();
    committedText.length = 0;

    authState.current.user = null;
    view.rerender(control());

    expect(committedText.length).toBeGreaterThan(0);
    expect(committedText.every((text) => !text.includes(staleText))).toBe(true);
  });

  it('announces a failed save while retaining the prior unsubscribed state', async () => {
    subscriptions.saveNotificationSubscription.mockRejectedValue(new Error('write failed'));
    const user = userEvent.setup();
    render(<CardNameSubscriptionControl cardName="江戶川柯南" isKnownCardName />);

    await user.click(await screen.findByRole('button', { name: '訂閱江戶川柯南' }));
    await user.click(screen.getByRole('checkbox', { name: '以 Google 登入信箱接收每日摘要' }));
    await user.click(screen.getByRole('button', { name: '確認訂閱' }));

    expect((await screen.findByRole('alert')).textContent).toBe('無法更新卡名通知，請稍後再試。');
    expect(screen.getByRole('button', { name: '訂閱江戶川柯南' })).toBeTruthy();
  });

  it('ignores a stale subscription read from a previous authenticated UID', async () => {
    let finishFirstRead: ((subscription: NotificationSubscription | null) => void) | undefined;
    subscriptions.getNotificationSubscription.mockReturnValueOnce(new Promise((resolve) => {
      finishFirstRead = resolve;
    }));
    const view = render(<CardNameSubscriptionControl cardName="江戶川柯南" isKnownCardName />);
    expect(screen.getByText('卡名通知載入中')).toBeTruthy();

    authState.current.user = { uid: 'buyer-2', displayName: 'Second buyer', photoURL: null };
    subscriptions.getNotificationSubscription.mockResolvedValueOnce(null);
    view.rerender(<CardNameSubscriptionControl cardName="江戶川柯南" isKnownCardName />);

    expect(await screen.findByRole('button', { name: '訂閱江戶川柯南' })).toBeTruthy();
    await act(async () => finishFirstRead?.(savedSubscription(['江戶川柯南'])));
    expect(screen.getByRole('button', { name: '訂閱江戶川柯南' })).toBeTruthy();
  });

  it('ignores a stale save from a previous authenticated UID', async () => {
    let finishSave: (() => void) | undefined;
    subscriptions.saveNotificationSubscription.mockReturnValue(new Promise<void>((resolve) => {
      finishSave = resolve;
    }));
    const user = userEvent.setup();
    const view = render(<CardNameSubscriptionControl cardName="江戶川柯南" isKnownCardName />);

    await user.click(await screen.findByRole('button', { name: '訂閱江戶川柯南' }));
    await user.click(screen.getByRole('checkbox', { name: '以 Google 登入信箱接收每日摘要' }));
    await user.click(screen.getByRole('button', { name: '確認訂閱' }));
    expect((screen.getByRole('button', { name: '儲存中' }) as HTMLButtonElement).disabled).toBe(true);

    authState.current.user = { uid: 'buyer-2', displayName: 'Second buyer', photoURL: null };
    subscriptions.getNotificationSubscription.mockResolvedValueOnce(null);
    view.rerender(<CardNameSubscriptionControl cardName="江戶川柯南" isKnownCardName />);

    const secondBuyerButton = await screen.findByRole('button', { name: '訂閱江戶川柯南' });
    expect((secondBuyerButton as HTMLButtonElement).disabled).toBe(false);
    await act(async () => finishSave?.());
    expect(screen.getByRole('button', { name: '訂閱江戶川柯南' })).toBeTruthy();
  });

  it('finishes the committed buyer save after a different auth render is interrupted', async () => {
    let finishSave: (() => void) | undefined;
    subscriptions.saveNotificationSubscription.mockReturnValue(new Promise<void>((resolve) => {
      finishSave = resolve;
    }));
    let shouldSuspend = false;
    const suspended = new Promise<void>(() => undefined);
    function SuspendAfterControl() {
      if (shouldSuspend) throw suspended;
      return null;
    }
    const control = () => (
      <Suspense fallback={<p>切換中</p>}>
        <CardNameSubscriptionControl cardName="江戶川柯南" isKnownCardName />
        <SuspendAfterControl />
      </Suspense>
    );
    const user = userEvent.setup();
    const view = render(control());

    await user.click(await screen.findByRole('button', { name: '訂閱江戶川柯南' }));
    await user.click(screen.getByRole('checkbox', { name: '以 Google 登入信箱接收每日摘要' }));
    await user.click(screen.getByRole('button', { name: '確認訂閱' }));
    expect(screen.getByRole('button', { name: '儲存中' })).toBeTruthy();

    authState.current.user = { uid: 'buyer-2', displayName: 'Second buyer', photoURL: null };
    shouldSuspend = true;
    await act(async () => {
      startTransition(() => view.rerender(control()));
    });
    expect(screen.getByRole('button', { name: '儲存中' })).toBeTruthy();

    authState.current.user = { uid: 'buyer-1', displayName: 'Buyer', photoURL: null };
    shouldSuspend = false;
    await act(async () => finishSave?.());

    expect(await screen.findByRole('button', { name: '取消訂閱江戶川柯南' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '儲存中' })).toBeNull();
  });
});
