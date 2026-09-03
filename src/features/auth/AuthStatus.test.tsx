// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState } from './AuthProvider';
import { AuthStatus } from './AuthStatus';

const auth = vi.hoisted(() => ({
  current: {} as AuthState,
}));

vi.mock('./AuthProvider', () => ({
  useAuth: () => auth.current,
}));

function activeState(): AuthState {
  return {
    user: { uid: 'buyer-1', displayName: 'Buyer', photoURL: null },
    isLoading: false,
    error: null,
    accountAccessState: { state: 'active', access: null },
    isActiveAccount: true,
    signIn: vi.fn(),
    signOut: vi.fn(),
  };
}

afterEach(cleanup);

describe('AuthStatus', () => {
  beforeEach(() => {
    auth.current = activeState();
  });

  it('uses neutral Google account wording and exposes active navigation', () => {
    render(<AuthStatus />);

    expect(screen.getByText('Google 帳號：Buyer')).toBeTruthy();
    expect(screen.queryByText(/賣家登入中/)).toBeNull();
    expect(screen.getByRole('link', { name: '個人檔案' }).getAttribute('href')).toBe('#/profile');
    expect(screen.getByRole('link', { name: '我要上架' }).getAttribute('href')).toBe('#/sell');
    expect(screen.getByRole('link', { name: '賣家管理' }).getAttribute('href')).toBe('#/dashboard');
    expect(screen.getByRole('link', { name: '我的訂閱' }).getAttribute('href')).toBe('#/notifications');
  });

  it('keeps sign-out but hides privileged navigation for a suspended account', () => {
    auth.current = {
      ...activeState(),
      isActiveAccount: false,
      accountAccessState: {
        state: 'suspended',
        access: {
          uid: 'buyer-1', status: 'suspended', confirmedViolationCount: 1,
          suspensionReason: 'Reason', suspendedAt: new Date(), suspendedBy: 'admin-1',
          updatedAt: new Date(),
        },
      },
    };
    render(<AuthStatus />);

    expect(screen.getByText('Google 帳號：Buyer')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('帳號目前已停權');
    expect(screen.getByRole('button', { name: '登出' })).toBeTruthy();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('fails closed but keeps sign-out when access state is unavailable', () => {
    auth.current = {
      ...activeState(),
      isActiveAccount: false,
      accountAccessState: { state: 'unavailable', message: '請重新整理。' },
    };
    render(<AuthStatus />);

    expect(screen.getByRole('status').textContent).toBe('請重新整理。');
    expect(screen.getByRole('button', { name: '登出' })).toBeTruthy();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('preserves loading and signed-out guidance', () => {
    auth.current = {
      ...activeState(), user: null, isLoading: true,
      isActiveAccount: false, accountAccessState: { state: 'loading' },
    };
    const view = render(<AuthStatus />);
    expect(screen.getByText('登入狀態確認中')).toBeTruthy();

    auth.current = {
      ...activeState(), user: null, isLoading: false,
      isActiveAccount: false, accountAccessState: { state: 'signed-out' },
    };
    view.rerender(<AuthStatus />);
    expect(screen.getByText('買家可直接瀏覽；賣家上架需登入')).toBeTruthy();
    expect(screen.getByRole('button', { name: '使用 Google 登入' })).toBeTruthy();
  });
});
