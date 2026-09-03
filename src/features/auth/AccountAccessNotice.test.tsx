// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountAccessNotice } from './AccountAccessNotice';

afterEach(cleanup);

describe('AccountAccessNotice', () => {
  it('announces suspension, public browsing, and a safely rendered reason', () => {
    render(<AccountAccessNotice state={{
      state: 'suspended',
      access: {
        uid: 'buyer-1', status: 'suspended', confirmedViolationCount: 1,
        suspensionReason: '<img src=x onerror=alert(1)>',
        suspendedAt: new Date('2026-09-02T00:00:00.000Z'),
        suspendedBy: 'admin-1', updatedAt: new Date('2026-09-03T00:00:00.000Z'),
      },
    }} />);

    expect(screen.getByRole('status').textContent).toContain('帳號目前已停權，仍可瀏覽公開市集。');
    expect(screen.getByRole('status').textContent).toContain('<img src=x onerror=alert(1)>');
    expect(document.querySelector('img')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows retry guidance when account state is unavailable', () => {
    render(<AccountAccessNotice state={{
      state: 'unavailable',
      message: '無法確認帳號狀態，請重新整理後再試。',
    }} />);

    expect(screen.getByRole('status').textContent)
      .toBe('無法確認帳號狀態，請重新整理後再試。');
  });

  it('renders nothing for states that do not need blocking guidance', () => {
    const { container } = render(<AccountAccessNotice state={{ state: 'active', access: null }} />);
    expect(container.textContent).toBe('');
  });
});
