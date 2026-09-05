import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import {
  ACCOUNT_MODERATION_AUDIT_TYPES,
  ACCOUNT_MODERATION_OPERATION_STATUSES,
  isAccountModerationRequestId,
  parseSuspendModerationTargetRequest,
  readAccountModerationAuditEvent,
  readAccountModerationOperation,
  suspendModerationTarget,
  type AccountSuspensionDependencies,
  type AccountSuspensionTransaction,
} from './accountModeration.js';

const CREATED_AT = Timestamp.fromDate(new Date('2026-09-05T00:00:00.000Z'));
const LATER_AT = Timestamp.fromMillis(CREATED_AT.toMillis() + 1000);
const requestKey = 'a'.repeat(64);

const commonOperation = {
  actionId: 'action-1', targetUid: 'seller-1', sourceReportId: 'report-1',
  requestedBy: 'admin-1', reason: '重複違規', requestKey,
  confirmedViolationCount: 2, hiddenListingCount: 0,
  createdAt: CREATED_AT, updatedAt: CREATED_AT,
};

describe('account moderation contracts', () => {
  it('defines exact operation states, audit variants, and UUID request IDs', () => {
    expect(ACCOUNT_MODERATION_OPERATION_STATUSES).toEqual(['hiding', 'suspended', 'restored']);
    expect(ACCOUNT_MODERATION_AUDIT_TYPES).toEqual([
      'suspension_requested', 'suspension_completed', 'restored', 'listing_republished',
    ]);
    expect(isAccountModerationRequestId('018f47a8-7b2c-7a24-bf6f-3c5ee6f25a42')).toBe(true);
    expect(isAccountModerationRequestId('not-a-uuid')).toBe(false);
  });

  it('reads exact hiding, suspended, and restored operations', () => {
    expect(readAccountModerationOperation({ status: 'hiding', ...commonOperation }))
      .toMatchObject({ status: 'hiding', hiddenListingCount: 0 });
    expect(readAccountModerationOperation({
      status: 'suspended', ...commonOperation, hiddenListingCount: 3,
      completedAt: LATER_AT, updatedAt: LATER_AT,
    })).toMatchObject({ status: 'suspended', hiddenListingCount: 3 });
    expect(readAccountModerationOperation({
      status: 'restored', ...commonOperation, hiddenListingCount: 3,
      completedAt: LATER_AT, restoredAt: LATER_AT, restoredBy: 'admin-2',
      restorationReason: '申訴確認', restorationRequestKey: 'b'.repeat(64),
      updatedAt: LATER_AT,
    })).toMatchObject({ status: 'restored', restoredBy: 'admin-2' });
  });

  it.each([
    ['extra field', { status: 'hiding', ...commonOperation, email: 'private@example.test' }],
    ['bad request key', { status: 'hiding', ...commonOperation, requestKey: 'short' }],
    ['padded reason', { status: 'hiding', ...commonOperation, reason: ' 原因' }],
    ['negative count', { status: 'hiding', ...commonOperation, hiddenListingCount: -1 }],
    ['completion on hiding', { status: 'hiding', ...commonOperation, completedAt: LATER_AT }],
    ['missing completion', { status: 'suspended', ...commonOperation }],
  ])('rejects malformed stored operation: %s', (_label, value) => {
    expect(() => readAccountModerationOperation(value)).toThrowError(
      expect.objectContaining({ code: 'failed-precondition' }),
    );
  });

  it('reads strict create-only audit event variants', () => {
    const common = {
      targetUid: 'seller-1', suspensionActionId: 'action-1',
      sourceReportId: 'report-1', actorUid: 'admin-1', at: CREATED_AT,
    };
    expect(readAccountModerationAuditEvent({
      ...common, eventId: 'event-1', type: 'suspension_requested',
      reason: '重複違規', confirmedViolationCount: 2,
    })).toMatchObject({ type: 'suspension_requested' });
    expect(readAccountModerationAuditEvent({
      ...common, eventId: 'event-2', type: 'suspension_completed', hiddenListingCount: 3,
    })).toMatchObject({ type: 'suspension_completed' });
    expect(readAccountModerationAuditEvent({
      ...common, eventId: 'event-3', type: 'restored', reason: '申訴確認',
    })).toMatchObject({ type: 'restored' });
    expect(readAccountModerationAuditEvent({
      ...common, eventId: 'event-4', type: 'listing_republished',
      actorUid: 'seller-1', listingId: 'listing-1',
    })).toMatchObject({ type: 'listing_republished' });
  });

  it.each(['email', 'contactValue', 'description', 'evidence']) (
    'rejects private or extra audit field %s',
    (field) => {
      expect(() => readAccountModerationAuditEvent({
        eventId: 'event-1', type: 'restored', targetUid: 'seller-1',
        suspensionActionId: 'action-1', sourceReportId: 'report-1',
        actorUid: 'admin-1', reason: '恢復原因', at: CREATED_AT, [field]: 'private',
      })).toThrowError(expect.objectContaining({ code: 'failed-precondition' }));
    },
  );
});

const REQUEST_ID = '018f47a8-7b2c-7a24-bf6f-3c5ee6f25a42';
const NOW = new Date('2026-09-05T01:00:00.000Z');

function confirmedCase(overrides: Record<string, unknown> = {}) {
  return {
    status: 'confirmed', reportId: 'report-1', targetSellerId: 'seller-1',
    openedAt: CREATED_AT, rationale: '確認違規', decidedBy: 'admin-1',
    decidedAt: CREATED_AT, resultingConfirmedViolationCount: 2, ...overrides,
  };
}

function submittedReport(overrides: Record<string, unknown> = {}) {
  return {
    status: 'submitted', requestKey: 'c'.repeat(64), reporterId: 'buyer-1',
    targetSellerId: 'seller-1', listingSnapshot: {
      listingId: 'listing-1', cardType: 'case', cardName: '封鎖現場',
      cardId: '2200', rarity: 'SR', listingPrice: 500, createdAt: CREATED_AT,
    },
    createdAt: CREATED_AT, expiresAt: LATER_AT, category: 'other',
    description: '說明', evidence: [], submittedAt: CREATED_AT, ...overrides,
  };
}

interface SuspensionState {
  access: Record<string, unknown | null>;
  moderationCase: unknown | null;
  report: unknown | null;
  operation: unknown | null;
  operationWrite?: { id: string; data: Record<string, unknown> };
  accessWrite?: { uid: string; data: Record<string, unknown> };
  auditWrite?: { id: string; data: Record<string, unknown> };
}

function suspensionHarness(overrides: Partial<SuspensionState> = {}) {
  const state: SuspensionState = {
    access: {
      'admin-1': null,
      'seller-1': { status: 'active', confirmedViolationCount: 2, updatedAt: CREATED_AT },
    },
    moderationCase: confirmedCase(),
    report: submittedReport(),
    operation: null,
    ...overrides,
  };
  const transaction: AccountSuspensionTransaction = {
    getAccountAccess: vi.fn(async (uid) => state.access[uid] ?? null),
    getCase: vi.fn(async () => state.moderationCase),
    getReport: vi.fn(async () => state.report),
    getOperation: vi.fn(async () => state.operation),
    createOperation: vi.fn((id, data) => { state.operationWrite = { id, data }; }),
    setAccountAccess: vi.fn((uid, data) => { state.accessWrite = { uid, data }; }),
    createAudit: vi.fn((id, data) => { state.auditWrite = { id, data }; }),
  };
  const dependencies: AccountSuspensionDependencies = {
    now: () => NOW,
    runTransaction: async (operation) => operation(transaction),
  };
  return { state, transaction, dependencies };
}

const suspensionRequest = {
  authUid: 'admin-1', adminClaim: true,
  data: { reportId: 'report-1', requestId: REQUEST_ID, reason: '重複違規，停權處理' },
};

describe('open account suspension', () => {
  it('parses only the exact canonical suspension request', () => {
    expect(parseSuspendModerationTargetRequest(suspensionRequest.data))
      .toEqual(suspensionRequest.data);
    for (const data of [
      { ...suspensionRequest.data, email: 'private@example.test' },
      { ...suspensionRequest.data, requestId: 'not-a-uuid' },
      { ...suspensionRequest.data, reportId: ' report-1' },
      { ...suspensionRequest.data, reason: ' 原因' },
      { ...suspensionRequest.data, reason: '字'.repeat(1001) },
    ]) {
      expect(() => parseSuspendModerationTargetRequest(data)).toThrowError(
        expect.objectContaining({ code: 'invalid-argument' }),
      );
    }
  });

  it('atomically opens one admin-bound operation, blocks access, and audits the request', async () => {
    const { state, dependencies } = suspensionHarness();
    const result = await suspendModerationTarget(suspensionRequest, dependencies);

    expect(result).toEqual({
      actionId: expect.stringMatching(/^[0-9a-f]{64}$/u),
      status: 'hiding', targetUid: 'seller-1', hiddenListingCount: 0,
    });
    expect(state.operationWrite).toEqual({
      id: result.actionId,
      data: {
        actionId: result.actionId, status: 'hiding', targetUid: 'seller-1',
        sourceReportId: 'report-1', requestedBy: 'admin-1',
        reason: '重複違規，停權處理', requestKey: result.actionId,
        confirmedViolationCount: 2, hiddenListingCount: 0,
        createdAt: Timestamp.fromDate(NOW), updatedAt: Timestamp.fromDate(NOW),
      },
    });
    expect(state.accessWrite).toEqual({
      uid: 'seller-1', data: {
        status: 'suspended', confirmedViolationCount: 2,
        suspensionReason: '重複違規，停權處理', suspendedAt: Timestamp.fromDate(NOW),
        suspendedBy: 'admin-1', suspensionActionId: result.actionId,
        updatedAt: Timestamp.fromDate(NOW),
      },
    });
    expect(state.auditWrite).toEqual({
      id: `${result.actionId}_requested`, data: {
        eventId: `${result.actionId}_requested`, type: 'suspension_requested',
        targetUid: 'seller-1', suspensionActionId: result.actionId,
        sourceReportId: 'report-1', actorUid: 'admin-1',
        reason: '重複違規，停權處理', confirmedViolationCount: 2,
        at: Timestamp.fromDate(NOW),
      },
    });
    expect(JSON.stringify({
      result,
      operationWrite: state.operationWrite,
      accessWrite: state.accessWrite,
      auditWrite: state.auditWrite,
    })).not.toMatch(/email|contact|evidence|description/iu);
  });

  it.each([
    ['signed out', { authUid: null, adminClaim: true }, 'unauthenticated'],
    ['non-admin', { authUid: 'admin-1', adminClaim: false }, 'permission-denied'],
    ['truthy claim', { authUid: 'admin-1', adminClaim: 'true' }, 'permission-denied'],
  ])('denies %s before any write', async (_label, auth, code) => {
    const { state, dependencies } = suspensionHarness();
    await expect(suspendModerationTarget({ ...suspensionRequest, ...auth }, dependencies))
      .rejects.toMatchObject({ code });
    expect(state.operationWrite).toBeUndefined();
    expect(state.accessWrite).toBeUndefined();
    expect(state.auditWrite).toBeUndefined();
  });

  it.each([
    ['suspended admin', {
      access: {
        'admin-1': {
          status: 'suspended', confirmedViolationCount: 2, suspensionReason: '原因',
          suspendedAt: CREATED_AT, suspendedBy: 'admin-2', suspensionActionId: 'old-action',
          updatedAt: CREATED_AT,
        },
        'seller-1': { status: 'active', confirmedViolationCount: 2, updatedAt: CREATED_AT },
      },
    }],
    ['malformed admin', { access: {
      'admin-1': { status: 'active', confirmedViolationCount: 0, updatedAt: CREATED_AT, extra: true },
      'seller-1': { status: 'active', confirmedViolationCount: 2, updatedAt: CREATED_AT },
    } }],
    ['below threshold', { access: {
      'admin-1': null,
      'seller-1': { status: 'active', confirmedViolationCount: 1, updatedAt: CREATED_AT },
    } }],
    ['open case', { moderationCase: {
      status: 'open', reportId: 'report-1', targetSellerId: 'seller-1', openedAt: CREATED_AT,
    } }],
    ['mismatched report', { report: submittedReport({ targetSellerId: 'seller-2' }) }],
    ['malformed target', { access: {
      'admin-1': null,
      'seller-1': { status: 'active', confirmedViolationCount: 2, updatedAt: CREATED_AT, extra: true },
    } }],
  ])('fails closed without writes for %s', async (_label, override) => {
    const { state, dependencies } = suspensionHarness(override as Partial<SuspensionState>);
    await expect(suspendModerationTarget(suspensionRequest, dependencies)).rejects.toMatchObject({
      code: expect.stringMatching(/permission-denied|failed-precondition/),
    });
    expect(state.operationWrite).toBeUndefined();
    expect(state.accessWrite).toBeUndefined();
    expect(state.auditWrite).toBeUndefined();
  });

  it('prevents an administrator from suspending their own UID', async () => {
    const { state, dependencies } = suspensionHarness({
      access: { 'admin-1': { status: 'active', confirmedViolationCount: 2, updatedAt: CREATED_AT } },
      moderationCase: confirmedCase({ targetSellerId: 'admin-1' }),
      report: submittedReport({ targetSellerId: 'admin-1' }),
    });
    await expect(suspendModerationTarget(suspensionRequest, dependencies))
      .rejects.toMatchObject({ code: 'permission-denied' });
    expect(state.operationWrite).toBeUndefined();
  });

  it('returns an exact existing operation for an identical retry without writes', async () => {
    const first = suspensionHarness();
    const opened = await suspendModerationTarget(suspensionRequest, first.dependencies);
    const existing = first.state.operationWrite!.data;
    const retry = suspensionHarness({
      operation: existing,
      access: {
        'admin-1': null,
        'seller-1': first.state.accessWrite!.data,
      },
    });
    await expect(suspendModerationTarget(suspensionRequest, retry.dependencies))
      .resolves.toEqual(opened);
    expect(retry.state.operationWrite).toBeUndefined();
    expect(retry.state.accessWrite).toBeUndefined();
    expect(retry.state.auditWrite).toBeUndefined();
  });

  it('rejects a conflicting retry bound to the same request ID', async () => {
    const first = suspensionHarness();
    await suspendModerationTarget(suspensionRequest, first.dependencies);
    const retry = suspensionHarness({
      operation: first.state.operationWrite!.data,
      access: { 'admin-1': null, 'seller-1': first.state.accessWrite!.data },
    });
    await expect(suspendModerationTarget({
      ...suspensionRequest, data: { ...suspensionRequest.data, reason: '不同原因' },
    }, retry.dependencies)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(retry.state.operationWrite).toBeUndefined();
    expect(retry.state.accessWrite).toBeUndefined();
    expect(retry.state.auditWrite).toBeUndefined();
  });
});
