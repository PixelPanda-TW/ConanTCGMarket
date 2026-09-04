// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState } from '../auth/AuthProvider';
import type { ModerationCasePage, ModerationCaseSummary } from '../../domain/models';

const auth = vi.hoisted(() => ({ current: {} as AuthState }));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => auth.current }));

import { ModerationQueuePage } from './ModerationQueuePage';

const openCase: ModerationCaseSummary = {
  reportId: 'report-2', status: 'open', category: 'listing_mismatch',
  targetSellerId: 'seller-1', openedAt: new Date('2026-09-04T04:00:00Z'),
  listingSnapshot: {
    listingId: 'listing-1', cardType: 'character', cardName: '江戶川柯南',
    cardId: '0101', rarity: 'SR', listingPrice: 1200,
    createdAt: new Date('2026-09-03T04:00:00Z'),
  },
};
const confirmedCase: ModerationCaseSummary = {
  ...openCase, reportId: 'report-1', status: 'confirmed',
  openedAt: new Date('2026-09-03T04:00:00Z'),
  decidedAt: new Date('2026-09-04T05:00:00Z'), resultingConfirmedViolationCount: 2,
};

function state(overrides: Partial<AuthState> = {}): AuthState {
  return {
    user: { uid: 'admin-1', displayName: 'Admin', photoURL: null },
    isLoading: false, error: null,
    accountAccessState: { state: 'active', access: null },
    isActiveAccount: true,
    adminAccessState: { state: 'admin' },
    signIn: vi.fn(), signOut: vi.fn(), ...overrides,
  };
}

function emptyPage(): ModerationCasePage {
  return { cases: [], nextCursor: null };
}

afterEach(cleanup);

describe('ModerationQueuePage', () => {
  beforeEach(() => { auth.current = state(); });

  it.each([
    ['signed out', state({ user: null, isActiveAccount: false, accountAccessState: { state: 'signed-out' }, adminAccessState: { state: 'not-admin' } }), '請先使用 Google 登入'],
    ['loading', state({ adminAccessState: { state: 'loading' } }), '管理權限確認中'],
    ['not admin', state({ adminAccessState: { state: 'not-admin' } }), '無權限查看檢舉案件'],
    ['unavailable', state({ adminAccessState: { state: 'unavailable' } }), '無法確認管理權限'],
    ['suspended', state({
      isActiveAccount: false, adminAccessState: { state: 'not-admin' },
      accountAccessState: { state: 'suspended', access: {
        uid: 'admin-1', status: 'suspended', confirmedViolationCount: 1,
        suspensionReason: 'Reason', suspendedAt: new Date(), suspendedBy: 'admin-2',
        updatedAt: new Date(),
      } },
    }), '帳號目前已停權'],
  ])('renders protected %s state and performs no moderation read', async (_label, authState, text) => {
    auth.current = authState;
    const loadCases = vi.fn(async () => emptyPage());
    render(<ModerationQueuePage loadCases={loadCases} />);
    expect(await screen.findByText(new RegExp(text))).toBeTruthy();
    expect(loadCases).not.toHaveBeenCalled();
  });

  it('loads only approved summary fields as accessible case links', async () => {
    const loadCases = vi.fn(async () => ({ cases: [openCase, confirmedCase], nextCursor: null }));
    render(<ModerationQueuePage loadCases={loadCases} />);
    expect(await screen.findByRole('heading', { name: '檢舉案件' })).toBeTruthy();
    expect(loadCases).toHaveBeenCalledWith({ status: 'all', limit: 20, cursor: null });

    const list = screen.getByRole('list', { name: '檢舉案件清單' });
    expect(within(list).getAllByText('江戶川柯南')).toHaveLength(2);
    expect(within(list).getAllByText('商品資訊不符')).toHaveLength(2);
    expect(within(list).getAllByText('已確認違規').length).toBeGreaterThan(0);
    expect(within(list).getByText('累計 2 次')).toBeTruthy();
    expect(screen.getByRole('link', { name: /查看 report-2/u })).toHaveProperty(
      'href', 'http://localhost:3000/#/admin/moderation/report-2',
    );
    expect(document.body.textContent).not.toContain('buyer-1');
    expect(document.body.textContent).not.toContain('圖片與商品內容不符');
  });

  it('supports all four filters and replaces rather than mixes prior results', async () => {
    const loadCases = vi.fn(async ({ status }: { status: string }) => ({
      cases: status === 'confirmed' ? [confirmedCase]
        : status === 'open' || status === 'all' ? [openCase] : [],
      nextCursor: null,
    }));
    render(<ModerationQueuePage loadCases={loadCases as never} />);
    await screen.findByText('江戶川柯南');

    for (const [name, status] of [
      ['待審查', 'open'], ['已駁回', 'dismissed'], ['已確認違規', 'confirmed'], ['全部', 'all'],
    ]) {
      await userEvent.click(screen.getByRole('tab', { name }));
      await waitFor(() => expect(loadCases).toHaveBeenLastCalledWith({
        status, limit: 20, cursor: null,
      }));
    }
  });

  it('renders loading, empty, failure, and working retry states', async () => {
    let resolveFirst: ((page: ModerationCasePage) => void) | undefined;
    const loadCases = vi.fn()
      .mockImplementationOnce(() => new Promise<ModerationCasePage>((resolvePage) => { resolveFirst = resolvePage; }))
      .mockRejectedValueOnce(new Error('private server text'))
      .mockResolvedValueOnce(emptyPage());
    const view = render(<ModerationQueuePage loadCases={loadCases} />);
    expect(screen.getByRole('status').textContent).toContain('案件載入中');
    resolveFirst?.(emptyPage());
    expect(await screen.findByText('目前沒有檢舉案件。')).toBeTruthy();

    view.unmount();
    render(<ModerationQueuePage loadCases={loadCases} />);
    expect((await screen.findByRole('alert')).textContent).toContain('無法載入檢舉案件');
    expect(document.body.textContent).not.toContain('private server text');
    await userEvent.click(screen.getByRole('button', { name: '重新載入案件' }));
    expect(await screen.findByText('目前沒有檢舉案件。')).toBeTruthy();
  });

  it('appends bounded pages, removes duplicate IDs, and prevents concurrent load-more calls', async () => {
    let resolveMore: ((page: ModerationCasePage) => void) | undefined;
    const cursor = { openedAt: openCase.openedAt, key: openCase.reportId };
    const loadCases = vi.fn()
      .mockResolvedValueOnce({ cases: [openCase], nextCursor: cursor })
      .mockImplementationOnce(() => new Promise<ModerationCasePage>((resolvePage) => { resolveMore = resolvePage; }));
    render(<ModerationQueuePage loadCases={loadCases} />);
    const button = await screen.findByRole('button', { name: '載入更多' });
    await userEvent.click(button);
    await userEvent.click(button);
    expect(loadCases).toHaveBeenCalledTimes(2);
    expect(loadCases).toHaveBeenLastCalledWith({ status: 'all', limit: 20, cursor });

    resolveMore?.({ cases: [openCase, confirmedCase], nextCursor: null });
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    expect(screen.queryByRole('button', { name: '載入更多' })).toBeNull();
  });

  it('ignores stale first-page results after UID or filter changes', async () => {
    let resolveOld: ((page: ModerationCasePage) => void) | undefined;
    const loadCases = vi.fn()
      .mockImplementationOnce(() => new Promise<ModerationCasePage>((resolvePage) => { resolveOld = resolvePage; }))
      .mockResolvedValueOnce(emptyPage());
    const view = render(<ModerationQueuePage loadCases={loadCases} />);

    auth.current = state({ user: { uid: 'admin-2', displayName: 'Next', photoURL: null } });
    view.rerender(<ModerationQueuePage loadCases={loadCases} />);
    expect(await screen.findByText('目前沒有檢舉案件。')).toBeTruthy();
    resolveOld?.({ cases: [openCase], nextCursor: null });
    await Promise.resolve();
    expect(screen.queryByText('江戶川柯南')).toBeNull();
  });

  it('has visible focus treatment and a small-screen single-column layout', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');
    expect(css).toMatch(/\.moderation-queue[^}]*:focus-visible|\.moderation-queue[\s\S]*:focus-visible/u);
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*moderation-queue/u);
  });
});
