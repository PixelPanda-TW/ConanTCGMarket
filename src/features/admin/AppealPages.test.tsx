// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppealDetailPage } from './AppealDetailPage';
import { AppealQueuePage } from './AppealQueuePage';

const auth = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => auth.current }));
vi.mock('../../data/firestore/repositories', () => ({}));

const action = 'a'.repeat(64);
const statement = '請重新審查本次停權與相關交易證據。'.repeat(10);
const detail = {
  appealId: 'appeal-1', status: 'submitted' as const, targetUid: 'seller-1',
  suspensionActionId: action, statement, evidence: [],
  submittedAt: new Date('2026-09-05T00:00:00Z'), updatedAt: new Date('2026-09-05T00:00:00Z'),
};
afterEach(cleanup);
describe('admin appeal pages', () => {
  beforeEach(() => {
    auth.current = {
      user: { uid: 'admin-1' }, signIn: vi.fn(),
      accountAccessState: { state: 'active', access: null },
      adminAccessState: { state: 'admin' },
    };
  });
  it('shows a reachable filtered queue and private detail link', async () => {
    const load = vi.fn(async () => ({ appeals: [{
      appealId: 'appeal-1', status: 'submitted' as const, targetUid: 'seller-1',
      suspensionActionId: action, evidenceCount: 0,
      submittedAt: new Date(), updatedAt: new Date(),
    }], nextCursor: null }));
    render(<AppealQueuePage load={load} />);
    expect((await screen.findByRole('link', { name: '查看申訴' })).getAttribute('href'))
      .toBe('#/admin/appeals/appeal-1');
    fireEvent.click(screen.getByRole('tab', { name: '已核准' }));
    await waitFor(() => expect(load).toHaveBeenLastCalledWith({ status: 'approved', limit: 20, cursor: null }));
  });
  it('submits one approved decision with a stable request and reloads terminal detail', async () => {
    const load = vi.fn().mockResolvedValueOnce(detail).mockResolvedValueOnce({
      ...detail, status: 'approved', decidedAt: new Date(), decidedBy: 'admin-1',
      decisionRationale: '確認申訴成立。', updatedAt: new Date(),
    });
    const decide = vi.fn(async () => ({ appealId: 'appeal-1', status: 'approved' as const, decidedAt: new Date() }));
    render(<AppealDetailPage id="appeal-1" load={load} decide={decide}
      loadEvidence={vi.fn()}
      createId={() => '550e8400-e29b-41d4-a716-446655440000'} />);
    fireEvent.click(await screen.findByRole('button', { name: '核准並恢復帳號' }));
    fireEvent.change(screen.getByLabelText('審核說明'), { target: { value: '確認申訴成立。' } });
    fireEvent.click(screen.getByRole('button', { name: '確認審核' }));
    await waitFor(() => expect(decide).toHaveBeenCalledTimes(1));
    expect(decide).toHaveBeenCalledWith({
      appealId: 'appeal-1', requestId: '550e8400-e29b-41d4-a716-446655440000',
      decision: 'approved', rationale: '確認申訴成立。',
    });
    expect(await screen.findByText('已核准')).toBeTruthy();
  });
  it('fails closed for non-admin identities without loading data', () => {
    auth.current = { ...auth.current, adminAccessState: { state: 'not-admin' } };
    const load = vi.fn(); render(<AppealQueuePage load={load} />);
    expect(screen.getByRole('alert').textContent).toContain('無權限');
    expect(load).not.toHaveBeenCalled();
  });
});
