// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState } from '../auth/AuthProvider';
import type {
  ModerationCaseDetail,
  ModerationDecisionResult,
} from '../../domain/models';
import type { ModerationEvidenceData } from '../../data/firestore/repositories';

const auth = vi.hoisted(() => ({ current: {} as AuthState }));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => auth.current }));

import { ModerationCasePage } from './ModerationCasePage';

const openDetail: ModerationCaseDetail = {
  reportId: 'report-2', status: 'open', category: 'listing_mismatch',
  description: '圖片與商品內容不符', reporterId: 'buyer-1', targetSellerId: 'seller-1',
  listingSnapshot: {
    listingId: 'listing-1', cardType: 'character', cardName: '江戶川柯南',
    cardId: '0101', rarity: 'SR', listingPrice: 1200,
    createdAt: new Date('2026-09-03T04:00:00Z'),
  },
  submittedAt: new Date('2026-09-04T04:00:00Z'),
  openedAt: new Date('2026-09-04T04:00:00Z'),
  evidence: [],
  account: { status: 'active', confirmedViolationCount: 1, suspensionEligible: false },
};
const confirmedDetail: ModerationCaseDetail = {
  ...openDetail,
  status: 'confirmed', rationale: '證據與刊登內容不符', decidedBy: 'admin-1',
  decidedAt: new Date('2026-09-04T05:00:00Z'), resultingConfirmedViolationCount: 2,
  account: { status: 'active', confirmedViolationCount: 2, suspensionEligible: true },
};

function state(overrides: Partial<AuthState> = {}): AuthState {
  return {
    user: { uid: 'admin-1', displayName: 'Admin', photoURL: null },
    isLoading: false, error: null,
    accountAccessState: { state: 'active', access: null }, isActiveAccount: true,
    adminAccessState: { state: 'admin' }, signIn: vi.fn(), signOut: vi.fn(), ...overrides,
  };
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    loadCase: vi.fn(async (): Promise<ModerationCaseDetail> => openDetail),
    loadEvidence: vi.fn(async (): Promise<ModerationEvidenceData> => ({
      contentType: 'image/png', size: 3, dataBase64: 'AQID',
    })),
    decideCase: vi.fn(async (): Promise<ModerationDecisionResult> => ({
      reportId: 'report-2', status: 'confirmed',
      resultingConfirmedViolationCount: 2, suspensionEligible: true,
    })),
    ...overrides,
  };
}

afterEach(cleanup);

describe('ModerationCasePage', () => {
  beforeEach(() => {
    auth.current = state();
    vi.restoreAllMocks();
  });

  it.each([
    ['signed out', state({ user: null, isActiveAccount: false, accountAccessState: { state: 'signed-out' }, adminAccessState: { state: 'not-admin' } }), '請先使用 Google 登入'],
    ['loading', state({ adminAccessState: { state: 'loading' } }), '管理權限確認中'],
    ['not admin', state({ adminAccessState: { state: 'not-admin' } }), '無權限查看檢舉案件'],
    ['unavailable', state({ adminAccessState: { state: 'unavailable' } }), '無法確認管理權限'],
    ['suspended', state({
      isActiveAccount: false, adminAccessState: { state: 'not-admin' },
      accountAccessState: { state: 'suspended', access: {
        uid: 'admin-1', status: 'suspended', confirmedViolationCount: 1,
        suspensionReason: 'Reason', suspendedAt: new Date(), suspendedBy: 'admin-2', updatedAt: new Date(),
        suspensionActionId: 'action-1',
      } },
    }), '帳號目前已停權'],
  ])('blocks protected %s state before every private operation', async (_label, authState, text) => {
    auth.current = authState;
    const deps = dependencies();
    render(<ModerationCasePage id="report-2" {...deps} />);
    expect(await screen.findByText(new RegExp(text))).toBeTruthy();
    expect(deps.loadCase).not.toHaveBeenCalled();
    expect(deps.loadEvidence).not.toHaveBeenCalled();
    expect(deps.decideCase).not.toHaveBeenCalled();
  });

  it('renders exact report, listing, account data, and zero evidence controls', async () => {
    const deps = dependencies();
    render(<ModerationCasePage id="report-2" {...deps} />);
    expect(await screen.findByRole('heading', { name: '檢舉案件 report-2' })).toBeTruthy();
    expect(deps.loadCase).toHaveBeenCalledWith('report-2');
    for (const text of ['圖片與商品內容不符', 'buyer-1', 'seller-1', '江戶川柯南', '0101', 'SR', '1,200', '累計 1 次']) {
      expect(document.body.textContent).toContain(text);
    }
    expect(screen.queryByRole('button', { name: /載入證據/u })).toBeNull();
    expect(document.body.textContent).not.toContain('secret/path');
  });

  it('handles not-found, generic failure, and retry without leaking errors', async () => {
    const notFound = Object.assign(new Error('private case id'), { code: 'not-found' });
    const deps = dependencies({
      loadCase: vi.fn()
        .mockRejectedValueOnce(notFound)
        .mockRejectedValueOnce(new Error('private storage path'))
        .mockResolvedValueOnce(openDetail),
    });
    const first = render(<ModerationCasePage id="report-2" {...deps} />);
    expect(await screen.findByRole('heading', { name: '找不到檢舉案件' })).toBeTruthy();
    first.unmount();

    render(<ModerationCasePage id="report-2" {...deps} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(document.body.textContent).not.toContain('private storage path');
    await userEvent.click(screen.getByRole('button', { name: '重新載入案件' }));
    expect(await screen.findByText('圖片與商品內容不符')).toBeTruthy();
  });

  it('loads one of three evidence objects only on demand and revokes replacement/unmount URLs', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:evidence-0').mockReturnValueOnce('blob:evidence-1');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const withEvidence: ModerationCaseDetail = {
      ...openDetail,
      evidence: [
        { slot: 0, contentType: 'image/png', size: 3 },
        { slot: 1, contentType: 'image/jpeg', size: 3 },
        { slot: 2, contentType: 'image/webp', size: 3 },
      ],
    };
    const deps = dependencies({ loadCase: vi.fn(async () => withEvidence) });
    const view = render(<ModerationCasePage id="report-2" {...deps} />);
    const controls = await screen.findAllByRole('button', { name: /載入證據/u });
    expect(controls).toHaveLength(3);
    expect(deps.loadEvidence).not.toHaveBeenCalled();

    await userEvent.click(controls[0]);
    expect(await screen.findByRole('img', { name: '檢舉證據 1' })).toHaveProperty('src', 'blob:evidence-0');
    expect(deps.loadEvidence).toHaveBeenCalledWith({ reportId: 'report-2', slot: 0 });
    await userEvent.click(screen.getByRole('button', { name: '載入證據 2' }));
    expect(await screen.findByRole('img', { name: '檢舉證據 2' })).toHaveProperty('src', 'blob:evidence-1');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:evidence-0');
    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:evidence-1');
    expect(createObjectURL).toHaveBeenCalledTimes(2);
  });

  it('shows sanitized evidence failure and permits an explicit retry', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:evidence');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const loadEvidence = vi.fn()
      .mockRejectedValueOnce(new Error('secret generation'))
      .mockResolvedValueOnce({ contentType: 'image/png', size: 3, dataBase64: 'AQID' });
    const deps = dependencies({
      loadCase: vi.fn(async () => ({
        ...openDetail, evidence: [{ slot: 0, contentType: 'image/png', size: 3 }],
      })),
      loadEvidence,
    });
    render(<ModerationCasePage id="report-2" {...deps} />);
    await userEvent.click(await screen.findByRole('button', { name: '載入證據 1' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(document.body.textContent).not.toContain('secret generation');
    await userEvent.click(screen.getByRole('button', { name: '重新載入證據 1' }));
    expect(await screen.findByRole('img', { name: '檢舉證據 1' })).toBeTruthy();
  });

  it('validates rationale in an accessible dialog, closes with Escape, and restores focus', async () => {
    const deps = dependencies();
    render(<ModerationCasePage id="report-2" {...deps} />);
    const trigger = await screen.findByRole('button', { name: '駁回檢舉' });
    trigger.focus();
    await userEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: '駁回檢舉' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByLabelText(/裁決理由/u)).toBe(document.activeElement);
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '確認駁回' }));
    await userEvent.tab();
    expect(screen.getByLabelText(/裁決理由/u)).toBe(document.activeElement);
    await userEvent.click(screen.getByRole('button', { name: '確認駁回' }));
    expect(await screen.findByText('請填寫裁決理由。')).toBeTruthy();
    expect(deps.decideCase).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('keeps a decision single-flight, adopts trusted result, and reloads durable terminal detail', async () => {
    let resolveDecision: ((result: ModerationDecisionResult) => void) | undefined;
    const decideCase = vi.fn(() => new Promise<ModerationDecisionResult>((resolveResult) => {
      resolveDecision = resolveResult;
    }));
    const loadCase = vi.fn()
      .mockResolvedValueOnce(openDetail)
      .mockResolvedValueOnce(confirmedDetail);
    render(<ModerationCasePage id="report-2" {...dependencies({ loadCase, decideCase })} />);
    await userEvent.click(await screen.findByRole('button', { name: '確認違規' }));
    await userEvent.type(screen.getByLabelText(/裁決理由/u), '證據與刊登內容不符');
    const confirm = screen.getByRole('button', { name: '確認違規裁決' });
    await userEvent.click(confirm);
    await userEvent.click(confirm);
    expect(decideCase).toHaveBeenCalledTimes(1);
    expect(decideCase).toHaveBeenCalledWith({
      reportId: 'report-2', decision: 'confirmed', rationale: '證據與刊登內容不符',
    });

    resolveDecision?.({
      reportId: 'report-2', status: 'confirmed',
      resultingConfirmedViolationCount: 2, suspensionEligible: true,
    });
    expect(await screen.findByText('違規已確認，累計 2 次。')).toBeTruthy();
    expect(await screen.findByText('證據與刊登內容不符')).toBeTruthy();
    expect(loadCase).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: '確認違規' })).toBeNull();
    expect(screen.queryByRole('button', { name: /停權/u })).toBeNull();
    expect(screen.getByText('此帳號符合人工停權條件；停權操作將在後續批次提供。')).toBeTruthy();
  });

  it('keeps open controls after a sanitized decision failure', async () => {
    const deps = dependencies({ decideCase: vi.fn(async () => { throw new Error('private transaction'); }) });
    render(<ModerationCasePage id="report-2" {...deps} />);
    await userEvent.click(await screen.findByRole('button', { name: '駁回檢舉' }));
    await userEvent.type(screen.getByLabelText(/裁決理由/u), '證據不足');
    await userEvent.click(screen.getByRole('button', { name: '確認駁回' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(document.body.textContent).not.toContain('private transaction');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('ignores stale detail and evidence results after route or identity changes', async () => {
    let resolveOldCase: ((detail: ModerationCaseDetail) => void) | undefined;
    const loadCase = vi.fn()
      .mockImplementationOnce(() => new Promise<ModerationCaseDetail>((resolveDetail) => { resolveOldCase = resolveDetail; }))
      .mockResolvedValueOnce({ ...openDetail, reportId: 'report-3', description: '新案件內容' });
    const deps = dependencies({ loadCase });
    const view = render(<ModerationCasePage id="report-2" {...deps} />);
    auth.current = state({ user: { uid: 'admin-2', displayName: 'Next', photoURL: null } });
    view.rerender(<ModerationCasePage id="report-3" {...deps} />);
    expect(await screen.findByText('新案件內容')).toBeTruthy();
    resolveOldCase?.(openDetail);
    await Promise.resolve();
    expect(screen.queryByText('圖片與商品內容不符')).toBeNull();
  });

  it('does not create a Blob URL from evidence that resolves after a route change', async () => {
    let resolveEvidence: ((evidence: ModerationEvidenceData) => void) | undefined;
    const loadEvidence = vi.fn(() => new Promise<ModerationEvidenceData>((resolveValue) => {
      resolveEvidence = resolveValue;
    }));
    const loadCase = vi.fn()
      .mockResolvedValueOnce({
        ...openDetail, evidence: [{ slot: 0, contentType: 'image/png', size: 3 }],
      })
      .mockResolvedValueOnce({ ...openDetail, reportId: 'report-3' });
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:stale');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const deps = dependencies({ loadCase, loadEvidence });
    const view = render(<ModerationCasePage id="report-2" {...deps} />);
    await userEvent.click(await screen.findByRole('button', { name: '載入證據 1' }));
    view.rerender(<ModerationCasePage id="report-3" {...deps} />);
    await screen.findByRole('heading', { name: '檢舉案件 report-3' });
    resolveEvidence?.({ contentType: 'image/png', size: 3, dataBase64: 'AQID' });
    await Promise.resolve();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByRole('img')).toBeNull();
  });
});
