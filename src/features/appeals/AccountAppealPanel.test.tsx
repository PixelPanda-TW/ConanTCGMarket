// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const repositories = vi.hoisted(() => ({
  getOwnAccountAppeal: vi.fn(), submitAccountAppeal: vi.fn(),
}));
const storage = vi.hoisted(() => ({ uploadAccountAppealEvidence: vi.fn() }));
vi.mock('../../data/firestore/repositories', () => repositories);
vi.mock('../../data/storage/storageService', () => storage);
import { AccountAppealPanel } from './AccountAppealPanel';

const action = 'a'.repeat(64);
const id = '550e8400-e29b-41d4-a716-446655440000';
const statement = '請重新審查本次停權與相關交易證據及完整事件經過。'.repeat(8);

afterEach(cleanup);
describe('AccountAppealPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repositories.getOwnAccountAppeal.mockResolvedValue(null);
    storage.uploadAccountAppealEvidence.mockResolvedValue({
      slot: 0, generation: '123', contentType: 'image/png', size: 10,
    });
    repositories.submitAccountAppeal.mockResolvedValue({
      appealId: 'appeal-1', status: 'submitted', targetUid: 'seller-1',
      suspensionActionId: action, statement, evidence: [],
      submittedAt: new Date(), updatedAt: new Date(),
    });
  });

  it('loads empty state, validates, uploads, and submits once with stable IDs', async () => {
    render(<AccountAppealPanel uid="seller-1" suspensionActionId={action} createId={() => id} />);
    expect(await screen.findByRole('heading', { name: '申訴停權' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('申訴說明'), { target: { value: statement } });
    fireEvent.change(screen.getByLabelText('申訴證據'), {
      target: { files: [new File([new Uint8Array(10)], 'proof.png', { type: 'image/png' })] },
    });
    const submit = screen.getByRole('button', { name: '提交申訴' });
    fireEvent.click(submit); fireEvent.click(submit);
    await screen.findByText('申訴已提交，等待管理員審核。');
    expect(storage.uploadAccountAppealEvidence).toHaveBeenCalledWith(
      'seller-1', action, id, 0, expect.any(File),
    );
    expect(repositories.submitAccountAppeal).toHaveBeenCalledTimes(1);
    expect(repositories.submitAccountAppeal).toHaveBeenCalledWith(expect.objectContaining({
      uid: 'seller-1', suspensionActionId: action, requestId: id, draftId: id,
    }));
  });

  it('shows validation and retryable load errors without submitting', async () => {
    render(<AccountAppealPanel uid="seller-1" suspensionActionId={action} createId={() => id} />);
    await screen.findByRole('button', { name: '提交申訴' });
    fireEvent.click(screen.getByRole('button', { name: '提交申訴' }));
    expect(screen.getByRole('alert').textContent).toContain('100');
    expect(repositories.submitAccountAppeal).not.toHaveBeenCalled();
    cleanup();
    repositories.getOwnAccountAppeal.mockRejectedValueOnce(new Error('private'));
    render(<AccountAppealPanel uid="seller-1" suspensionActionId={action} createId={() => id} />);
    expect((await screen.findByRole('alert')).textContent).toContain('無法載入申訴狀態');
    fireEvent.click(screen.getByRole('button', { name: '重試載入' }));
    await waitFor(() => expect(repositories.getOwnAccountAppeal).toHaveBeenCalledTimes(3));
  });

  it.each([
    ['dismissed', '申訴未獲核准。'],
    ['approved', '申訴已核准，帳號已恢復。'],
  ])('renders immutable %s decision state', async (status, message) => {
    repositories.getOwnAccountAppeal.mockResolvedValue({
      appealId: 'appeal-1', status, targetUid: 'seller-1', suspensionActionId: action,
      statement, evidence: [], submittedAt: new Date(), updatedAt: new Date(),
      decidedAt: new Date(), decidedBy: 'admin-1', decisionRationale: '人工複核完成。',
    });
    render(<AccountAppealPanel uid="seller-1" suspensionActionId={action} createId={() => id} />);
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '提交申訴' })).toBeNull();
  });
});
