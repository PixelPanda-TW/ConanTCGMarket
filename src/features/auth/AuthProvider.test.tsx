// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountAccess } from '../../domain/models';

const authService = vi.hoisted(() => ({
  onAuthUserChanged: vi.fn(),
  signInWithGoogle: vi.fn(),
  signOutUser: vi.fn(),
  resolveAdminClaim: vi.fn(),
}));
const repositories = vi.hoisted(() => ({
  subscribeAccountAccess: vi.fn(),
}));

vi.mock('./authService', () => authService);
vi.mock('../../data/firestore/repositories', () => repositories);

import { AuthProvider, useAuth } from './AuthProvider';

interface AccessObserver {
  uid: string;
  onValue: (access: AccountAccess | null) => void;
  onError: (error: Error) => void;
  unsubscribe: ReturnType<typeof vi.fn>;
}

function Consumer() {
  const state = useAuth();
  return (
    <>
      <output aria-label="auth-state">{JSON.stringify({
        user: state.user,
        isLoading: state.isLoading,
        error: state.error,
        accountAccessState: state.accountAccessState,
        isActiveAccount: state.isActiveAccount,
        adminAccessState: state.adminAccessState,
      })}</output>
      <button type="button" onClick={() => void state.signIn()}>sign in</button>
      <button type="button" onClick={() => void state.signOut()}>sign out</button>
    </>
  );
}

function readState() {
  return JSON.parse(screen.getByLabelText('auth-state').textContent ?? '{}');
}

describe('AuthProvider', () => {
  let onAuthValue: ((user: { uid: string; displayName: string | null; photoURL: string | null } | null) => void) | undefined;
  let onAuthError: ((error: Error) => void) | undefined;
  let authUnsubscribe: ReturnType<typeof vi.fn>;
  let accessObservers: AccessObserver[];

  beforeEach(() => {
    vi.clearAllMocks();
    accessObservers = [];
    authUnsubscribe = vi.fn();
    authService.onAuthUserChanged.mockImplementation((onValue, onError) => {
      onAuthValue = onValue;
      onAuthError = onError;
      return authUnsubscribe;
    });
    repositories.subscribeAccountAccess.mockImplementation((uid, onValue, onError) => {
      const observer = { uid, onValue, onError, unsubscribe: vi.fn() };
      accessObservers.push(observer);
      return observer.unsubscribe;
    });
    authService.signInWithGoogle.mockResolvedValue(undefined);
    authService.signOutUser.mockResolvedValue(undefined);
    authService.resolveAdminClaim.mockResolvedValue(false);
  });

  afterEach(cleanup);

  it('starts unresolved and then resolves signed out', () => {
    render(<AuthProvider><Consumer /></AuthProvider>);
    expect(readState()).toMatchObject({
      user: null,
      isLoading: true,
      accountAccessState: { state: 'loading' },
      isActiveAccount: false,
    });

    act(() => onAuthValue?.(null));
    expect(readState()).toMatchObject({
      user: null,
      isLoading: false,
      accountAccessState: { state: 'signed-out' },
      isActiveAccount: false,
    });
    expect(repositories.subscribeAccountAccess).not.toHaveBeenCalled();
  });

  it('keeps a signed-in user loading until missing access resolves active', () => {
    render(<AuthProvider><Consumer /></AuthProvider>);
    act(() => onAuthValue?.({ uid: 'buyer-1', displayName: 'Buyer', photoURL: null }));

    expect(accessObservers).toHaveLength(1);
    expect(accessObservers[0]?.uid).toBe('buyer-1');
    expect(readState()).toMatchObject({
      user: { uid: 'buyer-1' }, isLoading: true,
      accountAccessState: { state: 'loading' }, isActiveAccount: false,
    });

    act(() => accessObservers[0]?.onValue(null));
    expect(readState()).toMatchObject({
      isLoading: false,
      accountAccessState: { state: 'active', access: null },
      isActiveAccount: true,
    });
  });

  it('maps explicit active and live suspended records without reload', () => {
    const active: AccountAccess = {
      uid: 'buyer-1', status: 'active', confirmedViolationCount: 0,
      updatedAt: new Date('2026-09-03T00:00:00.000Z'),
    };
    const suspended: AccountAccess = {
      uid: 'buyer-1', status: 'suspended', confirmedViolationCount: 1,
      suspensionReason: 'Reason', suspendedAt: new Date('2026-09-02T00:00:00.000Z'),
      suspendedBy: 'admin-1', updatedAt: new Date('2026-09-03T00:00:00.000Z'),
    };
    render(<AuthProvider><Consumer /></AuthProvider>);
    act(() => onAuthValue?.({ uid: 'buyer-1', displayName: 'Buyer', photoURL: null }));
    act(() => accessObservers[0]?.onValue(active));
    expect(readState()).toMatchObject({
      accountAccessState: { state: 'active', access: { uid: 'buyer-1' } },
      isActiveAccount: true,
    });

    act(() => accessObservers[0]?.onValue(suspended));
    expect(readState()).toMatchObject({
      user: { uid: 'buyer-1' }, isLoading: false,
      accountAccessState: { state: 'suspended', access: { suspensionReason: 'Reason' } },
      isActiveAccount: false,
    });
  });

  it('fails account access closed without turning it into an authentication error', () => {
    render(<AuthProvider><Consumer /></AuthProvider>);
    act(() => onAuthValue?.({ uid: 'buyer-1', displayName: 'Buyer', photoURL: null }));
    act(() => accessObservers[0]?.onError(new Error('permission denied')));

    expect(readState()).toMatchObject({
      user: { uid: 'buyer-1' }, isLoading: false, error: null,
      accountAccessState: {
        state: 'unavailable', message: '無法確認帳號狀態，請重新整理後再試。',
      },
      isActiveAccount: false,
    });
  });

  it('reports an authentication observer error separately and stops loading', () => {
    render(<AuthProvider><Consumer /></AuthProvider>);
    act(() => onAuthError?.(new Error('Authentication observer failed.')));

    expect(readState()).toMatchObject({
      user: null, isLoading: false, error: 'Authentication observer failed.',
      accountAccessState: { state: 'signed-out' }, isActiveAccount: false,
    });
  });

  it('unsubscribes on UID changes and ignores callbacks from the prior UID', () => {
    render(<AuthProvider><Consumer /></AuthProvider>);
    act(() => onAuthValue?.({ uid: 'buyer-1', displayName: 'One', photoURL: null }));
    const prior = accessObservers[0]!;
    act(() => prior.onValue(null));

    act(() => onAuthValue?.({ uid: 'buyer-2', displayName: 'Two', photoURL: null }));
    expect(prior.unsubscribe).toHaveBeenCalledOnce();
    expect(readState()).toMatchObject({ user: { uid: 'buyer-2' }, isLoading: true });

    act(() => prior.onValue({
      uid: 'buyer-1', status: 'active', confirmedViolationCount: 0, updatedAt: new Date(),
    }));
    expect(readState()).toMatchObject({
      user: { uid: 'buyer-2' }, accountAccessState: { state: 'loading' },
    });

    act(() => accessObservers[1]?.onValue(null));
    expect(readState()).toMatchObject({
      user: { uid: 'buyer-2' }, accountAccessState: { state: 'active' },
    });
  });

  it('unsubscribes both observers and ignores callbacks after unmount', () => {
    const view = render(<AuthProvider><Consumer /></AuthProvider>);
    act(() => onAuthValue?.({ uid: 'buyer-1', displayName: 'Buyer', photoURL: null }));
    const observer = accessObservers[0]!;

    view.unmount();
    expect(authUnsubscribe).toHaveBeenCalledOnce();
    expect(observer.unsubscribe).toHaveBeenCalledOnce();
    expect(() => observer.onValue(null)).not.toThrow();
  });

  it('retains retryable sign-in and sign-out errors', async () => {
    authService.signInWithGoogle.mockRejectedValueOnce(new Error('Popup closed.'));
    authService.signOutUser.mockRejectedValueOnce(new Error('Sign-out failed.'));
    render(<AuthProvider><Consumer /></AuthProvider>);
    act(() => onAuthValue?.(null));

    fireEvent.click(screen.getByRole('button', { name: 'sign in' }));
    await waitFor(() => expect(readState().error).toBe('Popup closed.'));
    fireEvent.click(screen.getByRole('button', { name: 'sign out' }));
    await waitFor(() => expect(readState().error).toBe('Sign-out failed.'));
  });

  it('resolves an exact admin claim only after account access is active', async () => {
    authService.resolveAdminClaim.mockResolvedValueOnce(true);
    render(<AuthProvider><Consumer /></AuthProvider>);
    act(() => onAuthValue?.({ uid: 'admin-1', displayName: 'Admin', photoURL: null }));
    expect(readState().adminAccessState).toEqual({ state: 'loading' });

    await waitFor(() => expect(authService.resolveAdminClaim).toHaveBeenCalledWith('admin-1'));
    expect(readState().adminAccessState).toEqual({ state: 'loading' });
    act(() => accessObservers[0]?.onValue(null));
    await waitFor(() => expect(readState().adminAccessState).toEqual({ state: 'admin' }));
  });

  it('looks up the token once per authenticated UID transition', async () => {
    render(<AuthProvider><Consumer /></AuthProvider>);
    act(() => onAuthValue?.({ uid: 'buyer-1', displayName: 'One', photoURL: null }));
    await waitFor(() => expect(authService.resolveAdminClaim).toHaveBeenCalledTimes(1));

    act(() => onAuthValue?.({ uid: 'buyer-1', displayName: 'Renamed', photoURL: null }));
    await Promise.resolve();
    expect(authService.resolveAdminClaim).toHaveBeenCalledTimes(1);

    act(() => onAuthValue?.({ uid: 'buyer-2', displayName: 'Two', photoURL: null }));
    await waitFor(() => expect(authService.resolveAdminClaim).toHaveBeenCalledTimes(2));
    expect(authService.resolveAdminClaim).toHaveBeenLastCalledWith('buyer-2');
  });

  it('keeps ordinary active access when admin claim lookup fails', async () => {
    authService.resolveAdminClaim.mockRejectedValueOnce(new Error('token unavailable'));
    render(<AuthProvider><Consumer /></AuthProvider>);
    act(() => onAuthValue?.({ uid: 'buyer-1', displayName: 'Buyer', photoURL: null }));
    act(() => accessObservers[0]?.onValue(null));

    await waitFor(() => expect(readState()).toMatchObject({
      accountAccessState: { state: 'active' },
      isActiveAccount: true,
      adminAccessState: { state: 'unavailable' },
    }));
  });

  it('invalidates a stale admin lookup across identity changes and logout', async () => {
    let resolveFirst: ((value: boolean) => void) | undefined;
    authService.resolveAdminClaim
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(false);
    render(<AuthProvider><Consumer /></AuthProvider>);
    act(() => onAuthValue?.({ uid: 'admin-1', displayName: 'One', photoURL: null }));
    act(() => accessObservers[0]?.onValue(null));
    act(() => onAuthValue?.({ uid: 'buyer-2', displayName: 'Two', photoURL: null }));
    act(() => accessObservers[1]?.onValue(null));
    await waitFor(() => expect(readState().adminAccessState).toEqual({ state: 'not-admin' }));

    await act(async () => { resolveFirst?.(true); });
    expect(readState()).toMatchObject({
      user: { uid: 'buyer-2' }, adminAccessState: { state: 'not-admin' },
    });

    act(() => onAuthValue?.(null));
    expect(readState().adminAccessState).toEqual({ state: 'not-admin' });
  });

  it('removes admin access immediately when the live account becomes suspended', async () => {
    authService.resolveAdminClaim.mockResolvedValueOnce(true);
    render(<AuthProvider><Consumer /></AuthProvider>);
    act(() => onAuthValue?.({ uid: 'admin-1', displayName: 'Admin', photoURL: null }));
    act(() => accessObservers[0]?.onValue(null));
    await waitFor(() => expect(readState().adminAccessState).toEqual({ state: 'admin' }));
    act(() => accessObservers[0]?.onValue({
      uid: 'admin-1', status: 'suspended', confirmedViolationCount: 1,
      suspensionReason: 'Reason', suspendedAt: new Date(), suspendedBy: 'admin-2',
      updatedAt: new Date(),
    }));
    expect(readState().adminAccessState).toEqual({ state: 'not-admin' });
  });
});
