// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthStatus } from './AuthStatus';

vi.mock('./AuthProvider', () => ({
  useAuth: () => ({
    user: { uid: 'buyer-1', displayName: 'Buyer', photoURL: null },
    isLoading: false,
    error: null,
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));

afterEach(cleanup);

it('links authenticated buyers to notification settings', () => {
  render(<AuthStatus />);

  expect(screen.getByRole('link', { name: '通知設定' }).getAttribute('href')).toBe('#/notifications');
});
