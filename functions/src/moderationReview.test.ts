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
  getModerationCase,
  getModerationEvidence,
  decideModerationCase,
  type ModerationCaseListDependencies,
  type ModerationCaseDetailDependencies,
  type ModerationEvidenceDependencies,
  type ModerationDecisionDependencies,
  type ModerationDecisionTransaction,
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

function detailHarness(overrides: Partial<ModerationCaseDetailDependencies> = {}) {
  const report = submittedReport({
    evidence: [
      {
        path: 'reportEvidence/buyer-1/report-1/0', contentType: 'image/png',
        size: 100, generation: '123', md5Hash: 'private-hash',
      },
      {
        path: 'reportEvidence/buyer-1/report-1/2', contentType: 'image/webp',
        size: 200, generation: '456',
      },
    ],
  });
  const moderationCase = {
    status: 'open', reportId: 'report-1', targetSellerId: 'seller-1', openedAt: OPENED_AT,
  };
  const dependencies: ModerationCaseDetailDependencies = {
    getAccountAccess: vi.fn(async (uid) => (uid === 'seller-1' ? null : {
      status: 'active', confirmedViolationCount: 0, updatedAt: OPENED_AT,
    })),
    getCase: vi.fn(async () => moderationCase),
    getReport: vi.fn(async () => report),
    ...overrides,
  };
  return { report, moderationCase, dependencies };
}

const adminDetailRequest = {
  authUid: 'admin-1', adminClaim: true, data: { reportId: 'report-1' },
};

describe('get moderation case detail', () => {
  it('returns exact private detail and only sanitized evidence summaries', async () => {
    const { dependencies } = detailHarness();
    const result = await getModerationCase(adminDetailRequest, dependencies);

    expect(result).toEqual({
      reportId: 'report-1', status: 'open', category: 'listing_mismatch',
      description: 'private description', reporterId: 'buyer-1', targetSellerId: 'seller-1',
      listingSnapshot: { ...LISTING_SNAPSHOT, createdAt: LISTING_SNAPSHOT.createdAt.toMillis() },
      submittedAt: OPENED_AT.toMillis(), openedAt: OPENED_AT.toMillis(),
      evidence: [
        { slot: 0, contentType: 'image/png', size: 100 },
        { slot: 2, contentType: 'image/webp', size: 200 },
      ],
      account: { status: 'active', confirmedViolationCount: 0, suspensionEligible: false },
    });
    expect(JSON.stringify(result)).not.toMatch(/reportEvidence|generation|md5|contact|email/iu);
    expect(dependencies.getCase).toHaveBeenCalledWith('report-1');
    expect(dependencies.getReport).toHaveBeenCalledWith('report-1');
    expect(dependencies.getAccountAccess).toHaveBeenCalledWith('seller-1');
  });

  it('projects a confirmed case and canonical suspended target without hiding history', async () => {
    const confirmedCase = {
      status: 'confirmed', reportId: 'report-1', targetSellerId: 'seller-1',
      openedAt: OPENED_AT, rationale: '確認違規', decidedBy: 'admin-1',
      decidedAt: LATER_AT, resultingConfirmedViolationCount: 3,
    };
    const { dependencies } = detailHarness({
      getCase: vi.fn(async () => confirmedCase),
      getAccountAccess: vi.fn(async (uid) => (uid === 'admin-1' ? null : {
        status: 'suspended', confirmedViolationCount: 3, suspensionReason: '重複違規',
        suspendedAt: OPENED_AT, suspendedBy: 'admin-2', updatedAt: LATER_AT,
      })),
    });
    await expect(getModerationCase(adminDetailRequest, dependencies)).resolves.toMatchObject({
      status: 'confirmed', rationale: '確認違規', decidedBy: 'admin-1',
      decidedAt: LATER_AT.toMillis(), resultingConfirmedViolationCount: 3,
      account: { status: 'suspended', confirmedViolationCount: 3, suspensionEligible: true },
    });
  });

  it('returns terminal dismissal rationale without a confirmed result count', async () => {
    const dismissedCase = {
      status: 'dismissed', reportId: 'report-1', targetSellerId: 'seller-1',
      openedAt: OPENED_AT, rationale: '無法證實', decidedBy: 'admin-1', decidedAt: LATER_AT,
    };
    const { dependencies } = detailHarness({ getCase: vi.fn(async () => dismissedCase) });
    const result = await getModerationCase(adminDetailRequest, dependencies);
    expect(result).toMatchObject({ status: 'dismissed', rationale: '無法證實' });
    expect(result).not.toHaveProperty('resultingConfirmedViolationCount');
  });

  it.each([
    ['missing case', { getCase: vi.fn(async () => null) }],
    ['draft report', { getReport: vi.fn(async () => ({ ...submittedReport(), status: 'draft' })) }],
    ['target mismatch', { getCase: vi.fn(async () => ({
      status: 'open', reportId: 'report-1', targetSellerId: 'other', openedAt: OPENED_AT,
    })) }],
    ['malformed target access', { getAccountAccess: vi.fn(async (uid: string) => (
      uid === 'admin-1' ? null : {
        status: 'active', confirmedViolationCount: 0, updatedAt: OPENED_AT, email: 'private',
      }
    )) }],
    ['noncanonical evidence path', { getReport: vi.fn(async () => submittedReport({ evidence: [{
      path: 'reportEvidence/other/report-1/0', contentType: 'image/png', size: 1,
      generation: '1',
    }] })) }],
    ['unsorted evidence slots', { getReport: vi.fn(async () => submittedReport({ evidence: [
      { path: 'reportEvidence/buyer-1/report-1/2', contentType: 'image/png', size: 1, generation: '2' },
      { path: 'reportEvidence/buyer-1/report-1/0', contentType: 'image/png', size: 1, generation: '1' },
    ] })) }],
  ])('fails closed for %s', async (_label, overrides) => {
    const { dependencies } = detailHarness(overrides as Partial<ModerationCaseDetailDependencies>);
    await expect(getModerationCase(adminDetailRequest, dependencies))
      .rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('denies a non-admin before loading case data', async () => {
    const { dependencies } = detailHarness();
    await expect(getModerationCase({
      ...adminDetailRequest, adminClaim: false,
    }, dependencies)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(dependencies.getCase).not.toHaveBeenCalled();
    expect(dependencies.getReport).not.toHaveBeenCalled();
  });
});

function evidenceHarness(overrides: Partial<ModerationEvidenceDependencies> = {}) {
  const bytes = Buffer.from('private image bytes');
  const report = submittedReport({ evidence: [{
    path: 'reportEvidence/buyer-1/report-1/1', contentType: 'image/png',
    size: bytes.length, generation: '123', md5Hash: 'private-hash',
  }] });
  const dependencies: ModerationEvidenceDependencies = {
    getAccountAccess: vi.fn(async () => null),
    getCase: vi.fn(async () => ({
      status: 'open', reportId: 'report-1', targetSellerId: 'seller-1', openedAt: OPENED_AT,
    })),
    getReport: vi.fn(async () => report),
    getEvidenceMetadata: vi.fn(async () => ({
      contentType: 'image/png', size: String(bytes.length), generation: '123',
      md5Hash: 'private-hash', downloadTokens: 'must-not-return',
    })),
    downloadEvidence: vi.fn(async () => bytes),
    ...overrides,
  };
  return { bytes, report, dependencies };
}

const adminEvidenceRequest = {
  authUid: 'admin-1', adminClaim: true, data: { reportId: 'report-1', slot: 1 },
};

describe('get moderation evidence', () => {
  it('returns one generation-verified object as an exact base64 response', async () => {
    const { bytes, dependencies } = evidenceHarness();
    await expect(getModerationEvidence(adminEvidenceRequest, dependencies)).resolves.toEqual({
      contentType: 'image/png', size: bytes.length, dataBase64: bytes.toString('base64'),
    });
    expect(dependencies.getEvidenceMetadata).toHaveBeenCalledWith(
      'reportEvidence/buyer-1/report-1/1',
    );
    expect(dependencies.downloadEvidence).toHaveBeenCalledWith(
      'reportEvidence/buyer-1/report-1/1', '123',
    );
    expect(JSON.stringify(await getModerationEvidence(adminEvidenceRequest, dependencies)))
      .not.toMatch(/reportEvidence|generation|hash|token|url/iu);
  });

  it.each([
    ['unrecorded slot', {}, { data: { reportId: 'report-1', slot: 0 } }],
    ['missing object', { getEvidenceMetadata: vi.fn(async () => null) }, {}],
    ['changed MIME', { getEvidenceMetadata: vi.fn(async () => ({
      contentType: 'image/webp', size: '19', generation: '123',
    })) }, {}],
    ['changed size', { getEvidenceMetadata: vi.fn(async () => ({
      contentType: 'image/png', size: '1', generation: '123',
    })) }, {}],
    ['changed generation', { getEvidenceMetadata: vi.fn(async () => ({
      contentType: 'image/png', size: '19', generation: '124',
    })) }, {}],
    ['wrong downloaded byte size', { downloadEvidence: vi.fn(async () => Buffer.from('short')) }, {}],
  ])('fails closed for %s', async (_label, dependencyOverrides, requestOverrides) => {
    const { dependencies } = evidenceHarness(
      dependencyOverrides as Partial<ModerationEvidenceDependencies>,
    );
    await expect(getModerationEvidence({
      ...adminEvidenceRequest, ...requestOverrides,
    }, dependencies)).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('denies a non-admin before reading report or Storage data', async () => {
    const { dependencies } = evidenceHarness();
    await expect(getModerationEvidence({
      ...adminEvidenceRequest, adminClaim: false,
    }, dependencies)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(dependencies.getCase).not.toHaveBeenCalled();
    expect(dependencies.getEvidenceMetadata).not.toHaveBeenCalled();
    expect(dependencies.downloadEvidence).not.toHaveBeenCalled();
  });

  it('sanitizes Storage failures without returning object metadata', async () => {
    const { dependencies } = evidenceHarness({
      downloadEvidence: vi.fn(async () => { throw new Error('private-hash generation 123'); }),
    });
    await expect(getModerationEvidence(adminEvidenceRequest, dependencies)).rejects.toMatchObject({
      code: 'unavailable', message: '目前無法載入證據圖片。',
    });
  });
});

function decisionHarness(options: {
  moderationCase?: Record<string, unknown>;
  report?: Record<string, unknown>;
  targetAccess?: Record<string, unknown> | null;
} = {}) {
  const state = {
    moderationCase: options.moderationCase ?? {
      status: 'open', reportId: 'report-1', targetSellerId: 'seller-1', openedAt: OPENED_AT,
    },
    report: options.report ?? submittedReport(),
    targetAccess: options.targetAccess === undefined ? null : options.targetAccess,
  };
  const transaction: ModerationDecisionTransaction = {
    getCase: vi.fn(async () => state.moderationCase),
    getReport: vi.fn(async () => state.report),
    getAccountAccess: vi.fn(async () => state.targetAccess),
    setCase: vi.fn((_id, data) => { state.moderationCase = data; }),
    setAccountAccess: vi.fn((_uid, data) => { state.targetAccess = data; }),
  };
  const dependencies: ModerationDecisionDependencies = {
    now: () => LATER_AT.toDate(),
    getAccountAccess: vi.fn(async () => null),
    runTransaction: async (operation) => operation(transaction),
  };
  return { state, transaction, dependencies };
}

const dismissalRequest = {
  authUid: 'admin-1', adminClaim: true,
  data: { reportId: 'report-1', decision: 'dismissed', rationale: '無法證實' },
};
const confirmationRequest = {
  ...dismissalRequest,
  data: { reportId: 'report-1', decision: 'confirmed', rationale: '確認違規' },
};

describe('decide moderation case', () => {
  it('dismisses once without creating or changing target account access', async () => {
    const { state, transaction, dependencies } = decisionHarness();
    await expect(decideModerationCase(dismissalRequest, dependencies)).resolves.toEqual({
      reportId: 'report-1', status: 'dismissed',
      resultingConfirmedViolationCount: 0, suspensionEligible: false,
    });
    expect(state.moderationCase).toEqual({
      status: 'dismissed', reportId: 'report-1', targetSellerId: 'seller-1',
      openedAt: OPENED_AT, rationale: '無法證實', decidedBy: 'admin-1',
      decidedAt: LATER_AT,
    });
    expect(transaction.setAccountAccess).not.toHaveBeenCalled();
  });

  it('confirms a missing target access record and atomically creates count one', async () => {
    const { state, transaction, dependencies } = decisionHarness();
    await expect(decideModerationCase(confirmationRequest, dependencies)).resolves.toEqual({
      reportId: 'report-1', status: 'confirmed',
      resultingConfirmedViolationCount: 1, suspensionEligible: false,
    });
    expect(state.moderationCase).toMatchObject({
      status: 'confirmed', rationale: '確認違規', decidedBy: 'admin-1',
      decidedAt: LATER_AT, resultingConfirmedViolationCount: 1,
    });
    expect(transaction.setAccountAccess).toHaveBeenCalledWith('seller-1', {
      status: 'active', confirmedViolationCount: 1, updatedAt: LATER_AT,
    });
  });

  it('increments an active account to the threshold without suspending or changing Auth/Listings', async () => {
    const access = { status: 'active', confirmedViolationCount: 1, updatedAt: OPENED_AT };
    const { state, transaction, dependencies } = decisionHarness({ targetAccess: access });
    await expect(decideModerationCase(confirmationRequest, dependencies)).resolves.toEqual({
      reportId: 'report-1', status: 'confirmed',
      resultingConfirmedViolationCount: 2, suspensionEligible: true,
    });
    expect(state.targetAccess).toEqual({
      status: 'active', confirmedViolationCount: 2, updatedAt: LATER_AT,
    });
    expect(Object.keys(transaction).sort()).toEqual([
      'getAccountAccess', 'getCase', 'getReport', 'setAccountAccess', 'setCase',
    ]);
  });

  it('increments a suspended account while preserving every suspension field', async () => {
    const access = {
      status: 'suspended', confirmedViolationCount: 2, suspensionReason: '重複違規',
      suspendedAt: OPENED_AT, suspendedBy: 'admin-2', updatedAt: OPENED_AT,
    };
    const { state, dependencies } = decisionHarness({ targetAccess: access });
    await expect(decideModerationCase(confirmationRequest, dependencies)).resolves.toMatchObject({
      resultingConfirmedViolationCount: 3, suspensionEligible: true,
    });
    expect(state.targetAccess).toEqual({
      ...access, confirmedViolationCount: 3, updatedAt: LATER_AT,
    });
  });

  it('makes an identical retry write-free and never double-counts', async () => {
    const { state, transaction, dependencies } = decisionHarness({ targetAccess: {
      status: 'active', confirmedViolationCount: 1, updatedAt: OPENED_AT,
    } });
    const first = await decideModerationCase(confirmationRequest, dependencies);
    vi.mocked(transaction.setCase).mockClear();
    vi.mocked(transaction.setAccountAccess).mockClear();
    const retry = await decideModerationCase(confirmationRequest, dependencies);
    expect(retry).toEqual(first);
    expect(state.targetAccess?.confirmedViolationCount).toBe(2);
    expect(transaction.setCase).not.toHaveBeenCalled();
    expect(transaction.setAccountAccess).not.toHaveBeenCalled();
  });

  it.each([
    ['different decision', dismissalRequest],
    ['different rationale', {
      ...confirmationRequest,
      data: { ...confirmationRequest.data, rationale: '另一個理由' },
    }],
    ['different admin', { ...confirmationRequest, authUid: 'admin-2' }],
  ])('rejects a terminal retry from a %s', async (_label, retryRequest) => {
    const { transaction, dependencies } = decisionHarness({ targetAccess: {
      status: 'active', confirmedViolationCount: 1, updatedAt: OPENED_AT,
    } });
    await decideModerationCase(confirmationRequest, dependencies);
    vi.mocked(transaction.setCase).mockClear();
    vi.mocked(transaction.setAccountAccess).mockClear();
    await expect(decideModerationCase(retryRequest, dependencies))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    expect(transaction.setCase).not.toHaveBeenCalled();
    expect(transaction.setAccountAccess).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed target', { status: 'active', confirmedViolationCount: 0, updatedAt: OPENED_AT, extra: true }],
    ['negative count', { status: 'active', confirmedViolationCount: -1, updatedAt: OPENED_AT }],
  ])('fails closed without writes for %s', async (_label, targetAccess) => {
    const { transaction, dependencies } = decisionHarness({ targetAccess });
    await expect(decideModerationCase(confirmationRequest, dependencies))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    expect(transaction.setCase).not.toHaveBeenCalled();
    expect(transaction.setAccountAccess).not.toHaveBeenCalled();
  });

  it('denies a non-admin before entering the transaction', async () => {
    const { dependencies } = decisionHarness();
    dependencies.runTransaction = vi.fn(dependencies.runTransaction);
    await expect(decideModerationCase({
      ...confirmationRequest, adminClaim: false,
    }, dependencies)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(dependencies.runTransaction).not.toHaveBeenCalled();
  });
});
