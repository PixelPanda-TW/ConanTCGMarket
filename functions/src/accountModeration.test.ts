import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import {
  ACCOUNT_MODERATION_AUDIT_TYPES,
  ACCOUNT_MODERATION_OPERATION_STATUSES,
  isAccountModerationRequestId,
  parseSuspendModerationTargetRequest,
  reconcileAccountModerationOperation,
  drainAccountModerationOperation,
  ACCOUNT_MODERATION_HIDE_PAGE_SIZE,
  ACCOUNT_MODERATION_MAX_DRAIN_PAGES,
  readAccountModerationAuditEvent,
  readAccountModerationOperation,
  suspendModerationTarget,
  type AccountSuspensionDependencies,
  type AccountSuspensionTransaction,
  type AccountModerationReconciliationDependencies,
  type AccountModerationReconciliationTransaction,
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

function activeListing(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    data: {
      sellerId: 'seller-1', cardId: '2200', cardType: 'case', cardName: '封鎖現場',
      rarity: 'SR', imageUrls: [`https://example.com/${id}.jpg`], listingPrice: 500,
      originalQuantity: 5, remainingQuantity: 5, hasSleeve: false,
      supportsMyShip: false, status: 'active', createdAt: CREATED_AT.toDate(),
      updatedAt: CREATED_AT.toDate(), ...overrides,
    },
  };
}

function hidingOperation(overrides: Record<string, unknown> = {}) {
  return {
    status: 'hiding', ...commonOperation, actionId: requestKey, requestKey,
    targetUid: 'seller-1', sourceReportId: 'report-1', hiddenListingCount: 0,
    ...overrides,
  };
}

interface ReconciliationState {
  operation: unknown | null;
  access: unknown | null;
  listings: Array<{ id: string; data: unknown }>;
  listingWrites: Array<{ id: string; patch: Record<string, unknown> }>;
  operationWrites: Array<{ id: string; patch: Record<string, unknown> }>;
  auditWrites: Array<{ id: string; data: Record<string, unknown> }>;
}

function reconciliationHarness(overrides: Partial<ReconciliationState> = {}) {
  const state: ReconciliationState = {
    operation: hidingOperation(),
    access: {
      status: 'suspended', confirmedViolationCount: 2, suspensionReason: '重複違規',
      suspendedAt: CREATED_AT, suspendedBy: 'admin-1', suspensionActionId: requestKey,
      updatedAt: CREATED_AT,
    },
    listings: [activeListing('listing-1'), activeListing('listing-2')],
    listingWrites: [], operationWrites: [], auditWrites: [], ...overrides,
  };
  const transaction: AccountModerationReconciliationTransaction = {
    getOperation: vi.fn(async () => state.operation),
    getAccountAccess: vi.fn(async () => state.access),
    listActiveListings: vi.fn(async (_uid, _limit) => state.listings),
    updateListing: vi.fn((id, patch) => { state.listingWrites.push({ id, patch }); }),
    updateOperation: vi.fn((id, patch) => { state.operationWrites.push({ id, patch }); }),
    createAudit: vi.fn((id, data) => { state.auditWrites.push({ id, data }); }),
  };
  const dependencies: AccountModerationReconciliationDependencies = {
    now: () => NOW,
    runTransaction: async (operation) => operation(transaction),
  };
  return { state, transaction, dependencies };
}

describe('reconcile account suspension Listings', () => {
  it('uses fixed bounded reconciliation limits', () => {
    expect(ACCOUNT_MODERATION_HIDE_PAGE_SIZE).toBe(100);
    expect(ACCOUNT_MODERATION_MAX_DRAIN_PAGES).toBe(5);
  });

  it('holds one deterministic bounded page and advances the trusted count', async () => {
    const { state, transaction, dependencies } = reconciliationHarness();
    await expect(reconcileAccountModerationOperation(requestKey, dependencies)).resolves.toEqual({
      actionId: requestKey, status: 'hiding', targetUid: 'seller-1', hiddenListingCount: 2,
    });
    expect(transaction.listActiveListings).toHaveBeenCalledWith(
      'seller-1', ACCOUNT_MODERATION_HIDE_PAGE_SIZE,
    );
    expect(state.listingWrites).toEqual([
      { id: 'listing-1', patch: {
        status: 'suspended', suspensionActionId: requestKey,
        suspendedAt: CREATED_AT.toDate(), updatedAt: NOW,
      } },
      { id: 'listing-2', patch: {
        status: 'suspended', suspensionActionId: requestKey,
        suspendedAt: CREATED_AT.toDate(), updatedAt: NOW,
      } },
    ]);
    expect(state.operationWrites).toEqual([{ id: requestKey, patch: {
      hiddenListingCount: 2, updatedAt: Timestamp.fromDate(NOW),
    } }]);
    expect(state.auditWrites).toEqual([]);
  });

  it('completes only after an empty page and writes one deterministic audit', async () => {
    const { state, dependencies } = reconciliationHarness({
      operation: hidingOperation({ hiddenListingCount: 3 }), listings: [],
    });
    await expect(reconcileAccountModerationOperation(requestKey, dependencies)).resolves.toEqual({
      actionId: requestKey, status: 'suspended', targetUid: 'seller-1', hiddenListingCount: 3,
    });
    expect(state.listingWrites).toEqual([]);
    expect(state.operationWrites).toEqual([{ id: requestKey, patch: {
      status: 'suspended', completedAt: Timestamp.fromDate(NOW), updatedAt: Timestamp.fromDate(NOW),
    } }]);
    expect(state.auditWrites).toEqual([{ id: `${requestKey}_completed`, data: {
      eventId: `${requestKey}_completed`, type: 'suspension_completed',
      targetUid: 'seller-1', suspensionActionId: requestKey,
      sourceReportId: 'report-1', actorUid: 'admin-1', hiddenListingCount: 3,
      at: Timestamp.fromDate(NOW),
    } }]);
  });

  it('returns a completed or restored operation without querying or writing Listings', async () => {
    const suspended = reconciliationHarness({
      operation: {
        ...hidingOperation({ hiddenListingCount: 2 }), status: 'suspended', completedAt: LATER_AT,
        updatedAt: LATER_AT,
      },
    });
    await expect(reconcileAccountModerationOperation(requestKey, suspended.dependencies))
      .resolves.toMatchObject({ status: 'suspended', hiddenListingCount: 2 });
    expect(suspended.transaction.listActiveListings).not.toHaveBeenCalled();
    expect(suspended.state.operationWrites).toEqual([]);
  });

  it.each([
    ['wrong account action', {
      access: {
        status: 'suspended', confirmedViolationCount: 2, suspensionReason: '原因',
        suspendedAt: CREATED_AT, suspendedBy: 'admin-1', suspensionActionId: 'other-action',
        updatedAt: CREATED_AT,
      },
    }],
    ['active account', { access: { status: 'active', confirmedViolationCount: 2, updatedAt: CREATED_AT } }],
    ['malformed Listing', { listings: [activeListing('listing-1', { rarity: undefined })] }],
    ['wrong seller Listing', { listings: [activeListing('listing-1', { sellerId: 'seller-2' })] }],
    ['already held query result', { listings: [activeListing('listing-1', {
      status: 'suspended', suspensionActionId: requestKey, suspendedAt: CREATED_AT.toDate(),
    })] }],
  ])('fails closed without writes for %s', async (_label, override) => {
    const { state, dependencies } = reconciliationHarness(override as Partial<ReconciliationState>);
    await expect(reconcileAccountModerationOperation(requestKey, dependencies))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    expect(state.listingWrites).toEqual([]);
    expect(state.operationWrites).toEqual([]);
    expect(state.auditWrites).toEqual([]);
  });

  it('rejects an oversized or unsorted query page before writes', async () => {
    const oversized = Array.from(
      { length: ACCOUNT_MODERATION_HIDE_PAGE_SIZE + 1 },
      (_, index) => activeListing(`listing-${String(index).padStart(3, '0')}`),
    );
    const first = reconciliationHarness({ listings: oversized });
    await expect(reconcileAccountModerationOperation(requestKey, first.dependencies))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    expect(first.state.listingWrites).toEqual([]);

    const unsorted = reconciliationHarness({
      listings: [activeListing('listing-2'), activeListing('listing-1')],
    });
    await expect(reconcileAccountModerationOperation(requestKey, unsorted.dependencies))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    expect(unsorted.state.listingWrites).toEqual([]);
  });

  it('drains at most five pages and stops immediately at completion', async () => {
    const results = [
      { actionId: requestKey, status: 'hiding' as const, targetUid: 'seller-1', hiddenListingCount: 100 },
      { actionId: requestKey, status: 'hiding' as const, targetUid: 'seller-1', hiddenListingCount: 200 },
      { actionId: requestKey, status: 'suspended' as const, targetUid: 'seller-1', hiddenListingCount: 200 },
    ];
    const reconcile = vi.fn(async () => results.shift()!);
    await expect(drainAccountModerationOperation(requestKey, reconcile)).resolves.toMatchObject({
      status: 'suspended', hiddenListingCount: 200,
    });
    expect(reconcile).toHaveBeenCalledTimes(3);

    const stillHiding = vi.fn(async () => ({
      actionId: requestKey, status: 'hiding' as const,
      targetUid: 'seller-1', hiddenListingCount: 100,
    }));
    await expect(drainAccountModerationOperation(requestKey, stillHiding)).resolves.toMatchObject({
      status: 'hiding', hiddenListingCount: 100,
    });
    expect(stillHiding).toHaveBeenCalledTimes(ACCOUNT_MODERATION_MAX_DRAIN_PAGES);
  });
});
