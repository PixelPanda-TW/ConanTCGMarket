// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CharacterSubscriptionControl } from './CharacterSubscriptionControl';

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

describe('CharacterSubscriptionControl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.current.user = { uid: 'buyer-1', displayName: 'Buyer', photoURL: null };
    subscriptions.getNotificationSubscription.mockResolvedValue(null);
    subscriptions.saveNotificationSubscription.mockResolvedValue(undefined);
  });

  it('shows subscribe only for a known selected character and persists it for a signed-in buyer', async () => {
    const user = userEvent.setup();
    render(<CharacterSubscriptionControl characterName="諸伏景光" isKnownCharacter />);

    await user.click(await screen.findByRole('button', { name: '訂閱諸伏景光' }));

    await waitFor(() => expect(subscriptions.saveNotificationSubscription).toHaveBeenCalledWith(expect.objectContaining({
      uid: 'buyer-1',
      characterKeys: ['諸伏景光'],
      emailDailyEnabled: false,
      updatedAt: expect.any(Date),
    })));
    expect(await screen.findByRole('button', { name: '取消訂閱諸伏景光' })).toBeTruthy();
  });

  it('sends an unauthenticated buyer to Google sign-in guidance', async () => {
    authState.current.user = null;
    const user = userEvent.setup();
    render(<CharacterSubscriptionControl characterName="諸伏景光" isKnownCharacter />);

    await user.click(screen.getByRole('button', { name: '訂閱諸伏景光' }));

    expect(screen.getByText('登入後即可訂閱角色通知')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '使用 Google 登入' }));
    expect(authState.current.signIn).toHaveBeenCalledTimes(1);
  });

  it('does not render an interactive control for an unknown character', () => {
    render(<CharacterSubscriptionControl characterName="諸伏" isKnownCharacter={false} />);

    expect(screen.queryByRole('button')).toBeNull();
    expect(subscriptions.getNotificationSubscription).not.toHaveBeenCalled();
  });

  it('announces a save error without changing the subscription state', async () => {
    subscriptions.saveNotificationSubscription.mockRejectedValue(new Error('write failed'));
    const user = userEvent.setup();
    render(<CharacterSubscriptionControl characterName="諸伏景光" isKnownCharacter />);

    await user.click(await screen.findByRole('button', { name: '訂閱諸伏景光' }));

    expect((await screen.findByRole('alert')).textContent).toBe('無法更新角色通知，請稍後再試。');
    expect(screen.getByRole('button', { name: '訂閱諸伏景光' })).toBeTruthy();
  });

  it('does not apply a completed save after the authenticated buyer changes', async () => {
    let finishSave: (() => void) | undefined;
    subscriptions.saveNotificationSubscription.mockReturnValue(new Promise<void>((resolve) => {
      finishSave = resolve;
    }));
    const user = userEvent.setup();
    const view = render(<CharacterSubscriptionControl characterName="諸伏景光" isKnownCharacter />);

    await user.click(await screen.findByRole('button', { name: '訂閱諸伏景光' }));
    authState.current.user = { uid: 'buyer-2', displayName: 'Second buyer', photoURL: null };
    subscriptions.getNotificationSubscription.mockResolvedValueOnce(null);
    view.rerender(<CharacterSubscriptionControl characterName="諸伏景光" isKnownCharacter />);

    const secondBuyerButton = await screen.findByRole('button', { name: '訂閱諸伏景光' });
    expect((secondBuyerButton as HTMLButtonElement).disabled).toBe(false);
    await act(async () => finishSave?.());
    expect(screen.getByRole('button', { name: '訂閱諸伏景光' })).toBeTruthy();
  });
});
