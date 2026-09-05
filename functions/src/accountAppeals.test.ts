import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import {
  AccountAppealError,
  getOwnAccountAppeal,
  parseAccountAppealDecisionRequest,
  parseAccountAppealSubmissionRequest,
  readStoredAccountAppeal,
  submitAccountAppeal,
} from './accountAppeals.js';

const uuid = '123e4567-e89b-42d3-a456-426614174000';
const statement = '請重新審查這次停權，相關交易紀錄與說明如附件所示。'.repeat(5);

describe('account appeal contracts', () => {
  it('parses an exact bounded submission and evidence metadata', () => {
    expect(parseAccountAppealSubmissionRequest({
      suspensionActionId: 'action-1', requestId: uuid, draftId: uuid, statement,
      evidence: [{ slot: 0, generation: '123', contentType: 'image/png', size: 1024 }],
    })).toMatchObject({ suspensionActionId: 'action-1', statement });
  });

  it('rejects unknown fields, duplicate slots, invalid MIME, size, and text', () => {
    const base = { suspensionActionId: 'action-1', requestId: uuid, draftId: uuid, statement };
    for (const data of [
      { ...base, evidence: [], unknown: true },
      { ...base, evidence: [{ slot: 0, generation: '1', contentType: 'image/gif', size: 1 }] },
      { ...base, evidence: [{ slot: 0, generation: '1', contentType: 'image/png', size: 6 * 1024 * 1024 }] },
      { ...base, evidence: [0, 0].map(() => ({ slot: 0, generation: '1', contentType: 'image/png', size: 1 })) },
      { ...base, statement: 'short', evidence: [] },
    ]) expect(() => parseAccountAppealSubmissionRequest(data)).toThrow(AccountAppealError);
  });

  it('parses exact final decisions and rejects unsupported outcomes', () => {
    expect(parseAccountAppealDecisionRequest({
      appealId: 'appeal-1', requestId: uuid, decision: 'approved', rationale: '人工複核完成。',
    }).decision).toBe('approved');
    expect(() => parseAccountAppealDecisionRequest({
      appealId: 'appeal-1', requestId: uuid, decision: 'reopen', rationale: '人工複核完成。',
    })).toThrow(AccountAppealError);
  });

  it('reads exact timestamp-backed stored variants and rejects secret fields', () => {
    const value = {
      appealId: 'appeal-1', status: 'submitted', targetUid: 'seller-1',
      suspensionActionId: 'action-1', draftId: uuid, statement, evidence: [],
      requestKey: 'a'.repeat(64),
      submittedAt: Timestamp.fromMillis(1), updatedAt: Timestamp.fromMillis(1),
    };
    expect(readStoredAccountAppeal(value).status).toBe('submitted');
    expect(() => readStoredAccountAppeal({ ...value, email: 'secret@example.com' }))
      .toThrow(AccountAppealError);
  });
});

function submissionHarness() {
  const now = new Date('2026-09-05T01:00:00Z');
  const state = {
    access: {
      status: 'suspended', confirmedViolationCount: 2, suspensionReason: '停權原因',
      suspendedAt: Timestamp.fromMillis(1), suspendedBy: 'admin-1',
      suspensionActionId: 'action-1', updatedAt: Timestamp.fromMillis(1),
    } as unknown,
    operation: {
      actionId: 'action-1', status: 'suspended', targetUid: 'seller-1',
      sourceReportId: 'report-1', requestedBy: 'admin-1', reason: '停權原因',
      requestKey: 'b'.repeat(64), confirmedViolationCount: 2, hiddenListingCount: 1,
      createdAt: Timestamp.fromMillis(1), updatedAt: Timestamp.fromMillis(2),
      completedAt: Timestamp.fromMillis(2),
    } as unknown,
    appeal: null as unknown,
    pointer: null as unknown,
    limit: null as unknown,
  };
  const transaction = {
    getAccountAccess: vi.fn(async () => state.access),
    getOperation: vi.fn(async () => state.operation),
    getAppeal: vi.fn(async () => state.appeal),
    getRequestPointer: vi.fn(async () => state.pointer),
    getDailyLimit: vi.fn(async () => state.limit),
    createAppeal: vi.fn((_id: string, value: unknown) => { state.appeal = value; }),
    createEvidenceLock: vi.fn(),
    createRequestPointer: vi.fn((_id: string, value: unknown) => { state.pointer = value; }),
    setDailyLimit: vi.fn((_id: string, value: unknown) => { state.limit = value; }),
    createAudit: vi.fn(),
  };
  const dependencies = {
    now: () => now,
    getEvidenceMetadata: vi.fn(async () => ({
      generation: '123', contentType: 'image/png', size: 1024,
    })),
    runTransaction: async <T>(operation: (tx: typeof transaction) => Promise<T>) => operation(transaction),
  };
  const data = {
    suspensionActionId: 'action-1', requestId: uuid, draftId: uuid, statement,
    evidence: [{ slot: 0, generation: '123', contentType: 'image/png', size: 1024 }],
  };
  return { state, transaction, dependencies, data };
}

describe('submitAccountAppeal', () => {
  it('atomically creates one appeal, pointer, daily limit, and immutable audit', async () => {
    const fixture = submissionHarness();
    const result = await submitAccountAppeal(
      { authUid: 'seller-1', data: fixture.data }, fixture.dependencies,
    );
    expect(result).toMatchObject({ status: 'submitted', targetUid: 'seller-1' });
    expect(fixture.dependencies.getEvidenceMetadata).toHaveBeenCalledWith(
      `account-appeal-evidence/seller-1/action-1/${uuid}/0`,
    );
    expect(fixture.transaction.createAppeal).toHaveBeenCalledTimes(1);
    expect(fixture.transaction.createEvidenceLock).toHaveBeenCalledWith('action-1', {
      targetUid: 'seller-1', draftId: uuid, createdAt: expect.any(Timestamp),
    });
    expect(fixture.transaction.createAudit).toHaveBeenCalledTimes(1);
    expect(fixture.transaction.setDailyLimit).toHaveBeenCalledWith(
      'seller-1_2026-09-05', expect.objectContaining({ count: 1 }),
    );
  });

  it('returns the same appeal on an exact retry without additional writes', async () => {
    const fixture = submissionHarness();
    const request = { authUid: 'seller-1', data: fixture.data };
    const first = await submitAccountAppeal(request, fixture.dependencies);
    vi.mocked(fixture.transaction.createAppeal).mockClear();
    vi.mocked(fixture.transaction.createEvidenceLock).mockClear();
    vi.mocked(fixture.transaction.createAudit).mockClear();
    const second = await submitAccountAppeal(request, fixture.dependencies);
    expect(second).toEqual(first);
    expect(fixture.transaction.createAppeal).not.toHaveBeenCalled();
    expect(fixture.transaction.createEvidenceLock).not.toHaveBeenCalled();
    expect(fixture.transaction.createAudit).not.toHaveBeenCalled();
  });

  it('fails closed for wrong principals, stale actions, conflicting requests, and limits', async () => {
    for (const mutate of [
      (fixture: ReturnType<typeof submissionHarness>) => ({ authUid: null, data: fixture.data }),
      (fixture: ReturnType<typeof submissionHarness>) => {
        fixture.state.access = null; return { authUid: 'seller-1', data: fixture.data };
      },
      (fixture: ReturnType<typeof submissionHarness>) => {
        fixture.state.operation = { ...(fixture.state.operation as object), status: 'restored' };
        return { authUid: 'seller-1', data: fixture.data };
      },
      (fixture: ReturnType<typeof submissionHarness>) => {
        fixture.state.appeal = { existing: true }; return { authUid: 'seller-1', data: fixture.data };
      },
      (fixture: ReturnType<typeof submissionHarness>) => {
        fixture.state.limit = { targetUid: 'seller-1', utcDate: '2026-09-05', count: 5,
          createdAt: Timestamp.fromMillis(1), updatedAt: Timestamp.fromMillis(1) };
        return { authUid: 'seller-1', data: fixture.data };
      },
    ]) {
      const fixture = submissionHarness();
      await expect(submitAccountAppeal(mutate(fixture), fixture.dependencies))
        .rejects.toBeInstanceOf(AccountAppealError);
      expect(fixture.transaction.createAppeal).not.toHaveBeenCalled();
    }
  });
});

describe('getOwnAccountAppeal', () => {
  it('returns only the current suspended owner appeal and supports empty state', async () => {
    const fixture = submissionHarness();
    expect(await getOwnAccountAppeal(
      { authUid: 'seller-1', data: { suspensionActionId: 'action-1' } },
      { getAccountAccess: fixture.transaction.getAccountAccess, getAppeal: async () => null },
    )).toBeNull();
    const created = await submitAccountAppeal(
      { authUid: 'seller-1', data: fixture.data }, fixture.dependencies,
    );
    expect(await getOwnAccountAppeal(
      { authUid: 'seller-1', data: { suspensionActionId: 'action-1' } },
      { getAccountAccess: fixture.transaction.getAccountAccess, getAppeal: async () => created },
    )).toEqual(created);
  });

  it('rejects signed-out, active, stale-action, and mismatched appeal access', async () => {
    const fixture = submissionHarness();
    for (const [authUid, actionId, access, appeal] of [
      [null, 'action-1', fixture.state.access, null],
      ['seller-1', 'action-1', null, null],
      ['seller-1', 'old-action', fixture.state.access, null],
      ['seller-1', 'action-1', fixture.state.access, {
        appealId: 'bad', targetUid: 'other', suspensionActionId: 'action-1',
      }],
    ] as const) {
      await expect(getOwnAccountAppeal(
        { authUid, data: { suspensionActionId: actionId } },
        { getAccountAccess: async () => access, getAppeal: async () => appeal },
      )).rejects.toBeInstanceOf(AccountAppealError);
    }
  });
});
