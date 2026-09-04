// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Listing } from '../../domain/models';
import { ReportListingPage } from './ReportListingPage';

const repositories = vi.hoisted(() => ({
  createModerationReportDraft: vi.fn(),
  getListing: vi.fn(),
  submitModerationReport: vi.fn(),
}));
const storage = vi.hoisted(() => ({
  deleteReportEvidence: vi.fn(),
  uploadReportEvidence: vi.fn(),
}));
const authState = vi.hoisted(() => ({
  current: {
    user: { uid: 'buyer-1' } as { uid: string } | null,
    isLoading: false,
    isActiveAccount: true,
    accountAccessState: { state: 'active', access: null } as Record<string, unknown>,
    signIn: vi.fn(), signOut: vi.fn(),
  },
}));

vi.mock('../../data/firestore/repositories', () => repositories);
vi.mock('../../data/storage/storageService', () => storage);
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => authState.current }));

const listing: Listing = {
  id: 'listing-1', sellerId: 'seller-1', cardId: '0501', cardType: 'character',
  cardName: '諸伏高明', characterName: '諸伏高明', rarity: 'D',
  imageUrls: ['https://example.test/card.jpg'], listingPrice: 500,
  originalQuantity: 1, remainingQuantity: 1, hasSleeve: false, supportsMyShip: false,
  status: 'active', createdAt: new Date(), updatedAt: new Date(),
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function fillValidForm(files: File[] = []) {
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByLabelText('檢舉原因'), 'listing_mismatch');
  fireEvent.change(screen.getByLabelText('說明'), {
    target: { value: '卡片稀有度與商品資訊不符' },
  });
  if (files.length) fireEvent.change(screen.getByLabelText('證據圖片（選填）'), { target: { files } });
  return user;
}

afterEach(cleanup);

describe('ReportListingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    authState.current.user = { uid: 'buyer-1' };
    authState.current.isLoading = false;
    authState.current.isActiveAccount = true;
    authState.current.accountAccessState = { state: 'active', access: null };
    repositories.getListing.mockResolvedValue(listing);
    repositories.createModerationReportDraft.mockResolvedValue({
      reportId: 'report-1', expiresAt: new Date(Date.now() + 86_400_000),
    });
    repositories.submitModerationReport.mockResolvedValue({ reportId: 'report-1' });
    storage.uploadReportEvidence.mockImplementation(async (
      uid: string, reportId: string, slot: number,
    ) => `reportEvidence/${uid}/${reportId}/${slot}`);
    storage.deleteReportEvidence.mockResolvedValue(undefined);
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('550e8400-e29b-41d4-a716-446655440000');
  });

  it('guides a guest through Google sign-in without loading or losing Listing context', async () => {
    authState.current.user = null;
    authState.current.isActiveAccount = false;
    authState.current.accountAccessState = { state: 'signed-out' };
    window.location.hash = '#/listing/listing-1/report';
    render(<ReportListingPage id="listing-1" />);
    await userEvent.click(screen.getByRole('button', { name: '使用 Google 登入' }));
    expect(authState.current.signIn).toHaveBeenCalledOnce();
    expect(window.location.hash).toBe('#/listing/listing-1/report');
    expect(repositories.getListing).not.toHaveBeenCalled();
  });

  it('lets an active buyer without a Seller Profile submit a report without evidence', async () => {
    render(<ReportListingPage id="listing-1" />);
    const user = await fillValidForm();
    await user.click(screen.getByRole('button', { name: '送出檢舉' }));
    await screen.findByRole('status');
    expect(repositories.createModerationReportDraft).toHaveBeenCalledWith({
      uid: 'buyer-1', requestId: '550e8400-e29b-41d4-a716-446655440000', listingId: 'listing-1',
    });
    expect(repositories.submitModerationReport).toHaveBeenCalledWith({
      uid: 'buyer-1', reportId: 'report-1', category: 'listing_mismatch',
      description: '卡片稀有度與商品資訊不符', evidencePaths: [],
    });
  });

  it('uploads three approved images into ordered slots before finalization', async () => {
    render(<ReportListingPage id="listing-1" />);
    const files = ['image/jpeg', 'image/png', 'image/webp']
      .map((type, index) => new File([String(index)], `${index}.img`, { type }));
    const user = await fillValidForm(files);
    await user.click(screen.getByRole('button', { name: '送出檢舉' }));
    await waitFor(() => expect(repositories.submitModerationReport).toHaveBeenCalled());
    expect(storage.uploadReportEvidence.mock.calls.map((call) => call.slice(0, 3))).toEqual([
      ['buyer-1', 'report-1', 0], ['buyer-1', 'report-1', 1], ['buyer-1', 'report-1', 2],
    ]);
    expect(repositories.submitModerationReport.mock.calls[0][0].evidencePaths).toEqual([
      'reportEvidence/buyer-1/report-1/0', 'reportEvidence/buyer-1/report-1/1',
      'reportEvidence/buyer-1/report-1/2',
    ]);
  });

  it.each([
    ['owned', { ...listing, sellerId: 'buyer-1' }],
    ['sold', { ...listing, status: 'sold_out', remainingQuantity: 0 }],
    ['missing', null],
  ])('denies an %s Listing without creating a draft', async (_label, value) => {
    repositories.getListing.mockResolvedValue(value);
    render(<ReportListingPage id="listing-1" />);
    expect(await screen.findByRole('heading', { name: '無法檢舉商品' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '送出檢舉' })).toBeNull();
    expect(repositories.createModerationReportDraft).not.toHaveBeenCalled();
  });

  it('blocks suspended and unresolved account states before loading the Listing', () => {
    authState.current.isActiveAccount = false;
    authState.current.accountAccessState = { state: 'suspended', access: {} };
    render(<ReportListingPage id="listing-1" />);
    expect(screen.getByRole('heading', { name: '無法檢舉商品' })).toBeTruthy();
    expect(repositories.getListing).not.toHaveBeenCalled();
  });

  it('shows field errors and focuses the error summary before any remote operation', async () => {
    render(<ReportListingPage id="listing-1" />);
    await screen.findByRole('heading', { name: '檢舉商品' });
    await userEvent.click(screen.getByRole('button', { name: '送出檢舉' }));
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('請修正');
    expect(document.activeElement).toBe(alert);
    expect(repositories.createModerationReportDraft).not.toHaveBeenCalled();
  });

  it('prevents duplicate submit while pending', async () => {
    const pending = deferred<{ reportId: string; expiresAt: Date }>();
    repositories.createModerationReportDraft.mockReturnValue(pending.promise);
    render(<ReportListingPage id="listing-1" />);
    const user = await fillValidForm();
    const button = screen.getByRole('button', { name: '送出檢舉' });
    await user.click(button);
    await user.click(button);
    expect(repositories.createModerationReportDraft).toHaveBeenCalledOnce();
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps the same draft request across a failed upload retry', async () => {
    storage.uploadReportEvidence.mockRejectedValueOnce(new Error('upload failed'));
    render(<ReportListingPage id="listing-1" />);
    const user = await fillValidForm([new File(['x'], '0.png', { type: 'image/png' })]);
    await user.click(screen.getByRole('button', { name: '送出檢舉' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: '重新送出' }));
    await screen.findByRole('status');
    expect(repositories.createModerationReportDraft).toHaveBeenCalledTimes(1);
  });

  it('removes a previously staged slot before retrying with fewer images', async () => {
    repositories.submitModerationReport.mockRejectedValueOnce(new Error('submit failed'));
    render(<ReportListingPage id="listing-1" />);
    const firstFiles = [
      new File(['a'], '0.png', { type: 'image/png' }),
      new File(['b'], '1.png', { type: 'image/png' }),
    ];
    const user = await fillValidForm(firstFiles);
    await user.click(screen.getByRole('button', { name: '送出檢舉' }));
    await screen.findByRole('alert');
    fireEvent.change(screen.getByLabelText('證據圖片（選填）'), {
      target: { files: [firstFiles[0]] },
    });
    await user.click(screen.getByRole('button', { name: '重新送出' }));
    await screen.findByRole('status');
    expect(storage.deleteReportEvidence).toHaveBeenCalledWith('buyer-1', 'report-1', 1);
    expect(repositories.submitModerationReport).toHaveBeenLastCalledWith(
      expect.objectContaining({ evidencePaths: ['reportEvidence/buyer-1/report-1/0'] }),
    );
  });

  it('ignores stale completion after route context changes', async () => {
    const pending = deferred<{ reportId: string; expiresAt: Date }>();
    repositories.createModerationReportDraft.mockReturnValue(pending.promise);
    const view = render(<ReportListingPage id="listing-1" />);
    const user = await fillValidForm();
    await user.click(screen.getByRole('button', { name: '送出檢舉' }));
    repositories.getListing.mockResolvedValue({ ...listing, id: 'listing-2' });
    view.rerender(<ReportListingPage id="listing-2" />);
    pending.resolve({ reportId: 'report-1', expiresAt: new Date(Date.now() + 1000) });
    await waitFor(() => expect(repositories.getListing).toHaveBeenCalledWith('listing-2'));
    expect(repositories.submitModerationReport).not.toHaveBeenCalled();
  });

  it('shows only an opaque reference after success', async () => {
    render(<ReportListingPage id="listing-1" />);
    const user = await fillValidForm();
    await user.click(screen.getByRole('button', { name: '送出檢舉' }));
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('report-1');
    expect(status.textContent).not.toMatch(/seller-1|buyer-1|稀有度不符/iu);
  });

  it('restores a successful reference after reload within the same browser session', async () => {
    const first = render(<ReportListingPage id="listing-1" />);
    const user = await fillValidForm();
    await user.click(screen.getByRole('button', { name: '送出檢舉' }));
    await screen.findByText(/檢舉編號：/u);
    first.unmount();
    render(<ReportListingPage id="listing-1" />);
    expect((await screen.findByRole('status')).textContent).toBe('檢舉編號：report-1');
    expect(repositories.createModerationReportDraft).toHaveBeenCalledOnce();
  });
});
