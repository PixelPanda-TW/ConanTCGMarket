import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import {
  decideAccountAppeal,
  getAccountAppeal,
  getAccountAppealEvidence,
  listAccountAppeals,
  type AccountAppealDecisionDependencies,
  type AccountAppealDecisionTransaction,
} from './accountAppealReview.js';
import { AccountAppealError } from './accountAppeals.js';

const action = 'a'.repeat(64);
const requestId = '550e8400-e29b-41d4-a716-446655440000';
const at = Timestamp.fromMillis(1000);
const statement = '請重新審查本次停權與相關交易證據。'.repeat(10);
function appeal(overrides: Record<string, unknown> = {}) {
  return {
    appealId: 'appeal-1', status: 'submitted', targetUid: 'seller-1',
    suspensionActionId: action, draftId: requestId, statement, evidence: [],
    requestKey: 'b'.repeat(64), submittedAt: at, updatedAt: at, ...overrides,
  };
}
function operation(overrides: Record<string, unknown> = {}) {
  return {
    actionId: action, status: 'suspended', targetUid: 'seller-1', sourceReportId: 'report-1',
    requestedBy: 'admin-1', reason: '停權原因', requestKey: action,
    confirmedViolationCount: 3, hiddenListingCount: 2, createdAt: at, updatedAt: at,
    completedAt: at, ...overrides,
  };
}
function harness() {
  const state = {
    admin: null as unknown,
    target: { status: 'suspended', confirmedViolationCount: 3, suspensionReason: '停權原因',
      suspendedAt: at, suspendedBy: 'admin-1', suspensionActionId: action, updatedAt: at } as unknown,
    appeal: appeal() as unknown,
    operation: operation() as unknown,
  };
  const writes: Array<[string, unknown]> = [];
  const transaction: AccountAppealDecisionTransaction = {
    getAccountAccess: vi.fn(async (uid) => uid === 'admin-2' ? state.admin : state.target),
    getAppeal: vi.fn(async () => state.appeal),
    getOperation: vi.fn(async () => state.operation),
    updateAppeal: vi.fn((_id, patch) => writes.push(['appeal', patch])),
    setAccountAccess: vi.fn((_id, data) => writes.push(['access', data])),
    updateOperation: vi.fn((_id, patch) => writes.push(['operation', patch])),
    createAccountModerationAudit: vi.fn((_id, data) => writes.push(['account-audit', data])),
    createAppealAudit: vi.fn((_id, data) => writes.push(['appeal-audit', data])),
  };
  const dependencies: AccountAppealDecisionDependencies = {
    now: () => new Date('2026-09-05T00:00:00Z'),
    runTransaction: async (fn) => fn(transaction),
  };
  return { state, writes, transaction, dependencies };
}
const request = (decision: 'dismissed' | 'approved') => ({
  authUid: 'admin-2', adminClaim: true,
  data: { appealId: 'appeal-1', requestId, decision, rationale: '人工複核完成。' },
});

describe('decideAccountAppeal', () => {
  it('dismisses immutably without changing the account or operation', async () => {
    const fixture = harness();
    await expect(decideAccountAppeal(request('dismissed'), fixture.dependencies))
      .resolves.toMatchObject({ appealId: 'appeal-1', status: 'dismissed' });
    expect(fixture.writes.map(([kind]) => kind)).toEqual(['appeal', 'appeal-audit']);
  });

  it('approves and atomically reuses strict restoration while preserving count', async () => {
    const fixture = harness();
    await expect(decideAccountAppeal(request('approved'), fixture.dependencies))
      .resolves.toMatchObject({ appealId: 'appeal-1', status: 'approved' });
    expect(fixture.writes.map(([kind]) => kind)).toEqual([
      'access', 'operation', 'account-audit', 'appeal', 'appeal-audit',
    ]);
    expect(fixture.writes.find(([kind]) => kind === 'access')?.[1]).toMatchObject({
      status: 'active', confirmedViolationCount: 3,
    });
    expect(JSON.stringify(fixture.writes)).not.toMatch(/listing|decrement|delete/iu);
  });

  it('fails closed for inactive admin, self review, stale action, and restored operation', async () => {
    for (const mutate of [
      (fixture: ReturnType<typeof harness>) => { fixture.state.admin = { status: 'suspended' }; },
      (fixture: ReturnType<typeof harness>) => {
        fixture.state.appeal = appeal({ targetUid: 'admin-2' });
      },
      (fixture: ReturnType<typeof harness>) => {
        fixture.state.target = { ...(fixture.state.target as object), suspensionActionId: 'b'.repeat(64) };
      },
      (fixture: ReturnType<typeof harness>) => {
        fixture.state.operation = operation({ status: 'restored' });
      },
    ]) {
      const fixture = harness(); mutate(fixture);
      await expect(decideAccountAppeal(request('approved'), fixture.dependencies))
        .rejects.toBeInstanceOf(AccountAppealError);
      expect(fixture.writes).toEqual([]);
    }
  });
});

describe('account appeal admin reads', () => {
  const adminRequest = { authUid: 'admin-2', adminClaim: true };
  it('returns a bounded newest-first page without statement or internal keys', async () => {
    const newer = appeal({ submittedAt: Timestamp.fromMillis(2000), updatedAt: Timestamp.fromMillis(2000) });
    const older = appeal({ appealId: 'appeal-0' });
    const result = await listAccountAppeals({
      ...adminRequest, data: { status: 'submitted', limit: 2, cursor: null },
    }, {
      getAccountAccess: async () => null,
      listAppeals: async () => [{ id: 'appeal-1', data: newer }, { id: 'appeal-0', data: older }],
    });
    expect(result.appeals).toHaveLength(2);
    expect(result.nextCursor).toEqual({ submittedAt: 1000, key: 'appeal-0' });
    expect(JSON.stringify(result)).not.toMatch(/statement|requestKey|draftId|generation/iu);
  });

  it('returns strict detail and private evidence bytes without path or generation', async () => {
    const stored = appeal({
      evidence: [{ slot: 0, generation: '123', contentType: 'image/png', size: 3 }],
    });
    const base = { getAccountAccess: async () => null, getAppeal: async () => stored };
    await expect(getAccountAppeal({
      ...adminRequest, data: { appealId: 'appeal-1' },
    }, base)).resolves.toMatchObject({ appealId: 'appeal-1', statement });
    await expect(getAccountAppealEvidence({
      ...adminRequest, data: { appealId: 'appeal-1', slot: 0 },
    }, {
      ...base,
      getEvidenceMetadata: async () => ({ generation: '123', contentType: 'image/png', size: 3 }),
      downloadEvidence: async () => Buffer.from('abc'),
    })).resolves.toEqual({ contentType: 'image/png', size: 3, dataBase64: 'YWJj' });
  });

  it('denies non-admin reads before returning appeal data', async () => {
    await expect(getAccountAppeal({
      authUid: 'buyer-1', adminClaim: false, data: { appealId: 'appeal-1' },
    }, { getAccountAccess: async () => null, getAppeal: async () => appeal() }))
      .rejects.toBeInstanceOf(AccountAppealError);
  });
});
