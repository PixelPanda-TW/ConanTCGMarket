import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import {
  MODERATION_CASE_STATUSES,
  MODERATION_DECISIONS,
  parseDecideModerationCaseRequest,
  parseGetModerationCaseRequest,
  parseGetModerationEvidenceRequest,
  parseListModerationCasesRequest,
  readModerationCase,
  listModerationCases,
  type ModerationCaseListDependencies,
} from './moderationReview.js';

const OPENED_AT = Timestamp.fromDate(new Date('2026-09-04T00:00:00.000Z'));
const LATER_AT = Timestamp.fromMillis(OPENED_AT.toMillis() + 1000);

describe('moderation review contracts', () => {
  it('uses exact case statuses, decisions, and canonical requests', () => {
    expect(MODERATION_CASE_STATUSES).toEqual(['open', 'dismissed', 'confirmed']);
    expect(MODERATION_DECISIONS).toEqual(['dismissed', 'confirmed']);
    expect(parseListModerationCasesRequest({ status: 'open', limit: 20, cursor: null }))
      .toEqual({ status: 'open', limit: 20, cursor: null });
    expect(parseListModerationCasesRequest({ status: 'all' }))
      .toEqual({ status: 'all', limit: 20, cursor: null });
    expect(parseGetModerationCaseRequest({ reportId: 'report-1' }))
      .toEqual({ reportId: 'report-1' });
    expect(parseGetModerationEvidenceRequest({ reportId: 'report-1', slot: 2 }))
      .toEqual({ reportId: 'report-1', slot: 2 });
    expect(parseDecideModerationCaseRequest({
      reportId: 'report-1', decision: 'confirmed', rationale: '確認違規',
    })).toEqual({ reportId: 'report-1', decision: 'confirmed', rationale: '確認違規' });
  });

  it.each([
    ['unknown status', () => parseListModerationCasesRequest({ status: 'pending' })],
    ['limit zero', () => parseListModerationCasesRequest({ status: 'all', limit: 0 })],
    ['limit 51', () => parseListModerationCasesRequest({ status: 'all', limit: 51 })],
    ['invalid cursor', () => parseListModerationCasesRequest({
      status: 'all', cursor: { openedAt: -1, key: 'report-1' },
    })],
    ['extra list field', () => parseListModerationCasesRequest({ status: 'all', email: 'x@y.z' })],
    ['invalid report ID', () => parseGetModerationCaseRequest({ reportId: ' report-1' })],
    ['invalid evidence slot', () => parseGetModerationEvidenceRequest({ reportId: 'report-1', slot: 3 })],
    ['unknown decision', () => parseDecideModerationCaseRequest({
      reportId: 'report-1', decision: 'open', rationale: '原因',
    })],
    ['padded rationale', () => parseDecideModerationCaseRequest({
      reportId: 'report-1', decision: 'dismissed', rationale: ' 原因',
    })],
    ['long rationale', () => parseDecideModerationCaseRequest({
      reportId: 'report-1', decision: 'dismissed', rationale: '字'.repeat(1001),
    })],
  ])('rejects malformed moderation request: %s', (_label, operation) => {
    expect(operation).toThrowError(expect.objectContaining({ code: 'invalid-argument' }));
  });

  it('reads exact open, dismissed, and confirmed persisted cases', () => {
    expect(readModerationCase({
      status: 'open', reportId: 'report-1', targetSellerId: 'seller-1', openedAt: OPENED_AT,
    })).toMatchObject({ status: 'open' });
    expect(readModerationCase({
      status: 'dismissed', reportId: 'report-1', targetSellerId: 'seller-1',
      openedAt: OPENED_AT, rationale: '無法證實', decidedBy: 'admin-1', decidedAt: OPENED_AT,
    })).toMatchObject({ status: 'dismissed', rationale: '無法證實' });
    expect(readModerationCase({
      status: 'confirmed', reportId: 'report-1', targetSellerId: 'seller-1',
      openedAt: OPENED_AT, rationale: '確認違規', decidedBy: 'admin-1',
      decidedAt: OPENED_AT, resultingConfirmedViolationCount: 2,
    })).toMatchObject({ status: 'confirmed', resultingConfirmedViolationCount: 2 });
  });

  it.each([
    ['extra private field', { status: 'open', reportId: 'report-1', targetSellerId: 'seller-1', openedAt: OPENED_AT, email: 'private@example.test' }],
    ['missing rationale', { status: 'dismissed', reportId: 'report-1', targetSellerId: 'seller-1', openedAt: OPENED_AT, decidedBy: 'admin-1', decidedAt: OPENED_AT }],
    ['count on dismissed', { status: 'dismissed', reportId: 'report-1', targetSellerId: 'seller-1', openedAt: OPENED_AT, rationale: '原因', decidedBy: 'admin-1', decidedAt: OPENED_AT, resultingConfirmedViolationCount: 1 }],
    ['missing confirmed count', { status: 'confirmed', reportId: 'report-1', targetSellerId: 'seller-1', openedAt: OPENED_AT, rationale: '原因', decidedBy: 'admin-1', decidedAt: OPENED_AT }],
    ['padded actor', { status: 'dismissed', reportId: 'report-1', targetSellerId: 'seller-1', openedAt: OPENED_AT, rationale: '原因', decidedBy: ' admin-1', decidedAt: OPENED_AT }],
  ])('rejects malformed stored case: %s', (_label, value) => {
    expect(() => readModerationCase(value)).toThrowError(
      expect.objectContaining({ code: 'failed-precondition' }),
    );
  });
});

const LISTING_SNAPSHOT = {
  listingId: 'listing-1', cardType: 'character', cardName: '諸伏高明',
  cardId: '0501', rarity: 'D', listingPrice: 500,
  createdAt: Timestamp.fromDate(new Date('2026-09-01T00:00:00.000Z')),
};

function submittedReport(overrides: Record<string, unknown> = {}) {
  return {
    status: 'submitted', requestKey: 'a'.repeat(64), reporterId: 'buyer-1',
    targetSellerId: 'seller-1', listingSnapshot: LISTING_SNAPSHOT,
    createdAt: Timestamp.fromDate(new Date('2026-09-03T00:00:00.000Z')),
    expiresAt: Timestamp.fromDate(new Date('2026-09-05T00:00:00.000Z')),
    category: 'listing_mismatch', description: 'private description', evidence: [],
    submittedAt: OPENED_AT, ...overrides,
  };
}

function listHarness(overrides: Partial<ModerationCaseListDependencies> = {}) {
  const cases = [
    {
      id: 'report-2', data: {
        status: 'confirmed', reportId: 'report-2', targetSellerId: 'seller-2',
        openedAt: LATER_AT, rationale: 'private rationale',
        decidedBy: 'admin-1', decidedAt: Timestamp.fromMillis(LATER_AT.toMillis() + 1000),
        resultingConfirmedViolationCount: 2,
      },
    },
    {
      id: 'report-1', data: {
        status: 'open', reportId: 'report-1', targetSellerId: 'seller-1',
        openedAt: OPENED_AT,
      },
    },
  ];
  const reports = new Map<string, unknown>([
    ['report-2', submittedReport({
      targetSellerId: 'seller-2', submittedAt: LATER_AT,
    })],
    ['report-1', submittedReport()],
  ]);
  const dependencies: ModerationCaseListDependencies = {
    getAccountAccess: vi.fn(async () => null),
    listCases: vi.fn(async () => cases),
    getReports: vi.fn(async (ids) => ids.map((id) => ({ id, data: reports.get(id) ?? null }))),
    ...overrides,
  };
  return { cases, reports, dependencies };
}

const adminListRequest = {
  authUid: 'admin-1', adminClaim: true,
  data: { status: 'all', limit: 2, cursor: null },
};

describe('list moderation cases', () => {
  it('returns bounded deterministic summaries with no private report body', async () => {
    const { dependencies } = listHarness();
    const result = await listModerationCases(adminListRequest, dependencies);

    expect(dependencies.listCases).toHaveBeenCalledWith({ status: 'all', limit: 2, cursor: null });
    expect(dependencies.getReports).toHaveBeenCalledWith(['report-2', 'report-1']);
    expect(result).toEqual({
      cases: [
        {
          reportId: 'report-2', status: 'confirmed', category: 'listing_mismatch',
          targetSellerId: 'seller-2',
          listingSnapshot: { ...LISTING_SNAPSHOT, createdAt: LISTING_SNAPSHOT.createdAt.toMillis() },
          openedAt: LATER_AT.toMillis(),
          decidedAt: LATER_AT.toMillis() + 1000,
          resultingConfirmedViolationCount: 2,
        },
        {
          reportId: 'report-1', status: 'open', category: 'listing_mismatch',
          targetSellerId: 'seller-1',
          listingSnapshot: { ...LISTING_SNAPSHOT, createdAt: LISTING_SNAPSHOT.createdAt.toMillis() },
          openedAt: OPENED_AT.toMillis(),
        },
      ],
      nextCursor: { openedAt: OPENED_AT.toMillis(), key: 'report-1' },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /reporter|description|rationale|evidence|contact|email|decidedBy/iu,
    );
  });

  it('passes an exact status and cursor and returns an empty terminal page', async () => {
    const dependencies = listHarness({ listCases: vi.fn(async () => []) }).dependencies;
    await expect(listModerationCases({
      ...adminListRequest,
      data: { status: 'dismissed', limit: 10, cursor: { openedAt: 1000, key: 'report-0' } },
    }, dependencies)).resolves.toEqual({ cases: [], nextCursor: null });
    expect(dependencies.listCases).toHaveBeenCalledWith({
      status: 'dismissed', limit: 10, cursor: { openedAt: 1000, key: 'report-0' },
    });
    expect(dependencies.getReports).not.toHaveBeenCalled();
  });

  it.each([
    ['signed out', { authUid: null, adminClaim: true }, 'unauthenticated'],
    ['non-admin', { authUid: 'admin-1', adminClaim: false }, 'permission-denied'],
    ['string claim', { authUid: 'admin-1', adminClaim: 'true' }, 'permission-denied'],
    ['suspended admin', { authUid: 'admin-1', adminClaim: true }, 'permission-denied', {
      status: 'suspended', confirmedViolationCount: 2, suspensionReason: 'reason',
      suspendedAt: OPENED_AT, suspendedBy: 'admin-2', updatedAt: OPENED_AT,
    }],
    ['malformed admin', { authUid: 'admin-1', adminClaim: true }, 'permission-denied', {
      status: 'active', confirmedViolationCount: 0, updatedAt: OPENED_AT, extra: true,
    }],
  ])('denies %s before listing', async (_label, auth, code, access = null) => {
    const { dependencies } = listHarness({ getAccountAccess: vi.fn(async () => access) });
    await expect(listModerationCases({ ...adminListRequest, ...auth }, dependencies))
      .rejects.toMatchObject({ code });
    expect(dependencies.listCases).not.toHaveBeenCalled();
  });

  it.each([
    ['missing report', null],
    ['draft report', submittedReport({ status: 'draft' })],
    ['target mismatch', submittedReport({ targetSellerId: 'other-seller' })],
    ['time mismatch', submittedReport({ submittedAt: Timestamp.fromMillis(1) })],
    ['extra report field', { ...submittedReport(), contactValue: 'private' }],
  ])('fails closed for a %s', async (_label, report) => {
    const { dependencies } = listHarness({
      listCases: vi.fn(async () => [{
        id: 'report-1', data: {
          status: 'open', reportId: 'report-1', targetSellerId: 'seller-1', openedAt: OPENED_AT,
        },
      }]),
      getReports: vi.fn(async () => [{ id: 'report-1', data: report }]),
    });
    await expect(listModerationCases({
      ...adminListRequest, data: { status: 'all', limit: 1, cursor: null },
    }, dependencies)).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('sanitizes dependency failures without leaking case data', async () => {
    const { dependencies } = listHarness({
      listCases: vi.fn(async () => { throw new Error('private description'); }),
    });
    await expect(listModerationCases(adminListRequest, dependencies)).rejects.toMatchObject({
      code: 'unavailable', message: '目前無法載入審查案件。',
    });
  });
});
