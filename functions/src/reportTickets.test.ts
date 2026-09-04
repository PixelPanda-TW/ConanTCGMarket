import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import {
  createReportDraft,
  MODERATION_REPORT_CATEGORIES,
  parseCreateReportDraftRequest,
  parseSubmitReportRequest,
  projectReportListingSnapshot,
  readModerationReport,
  type CreateReportDraftDependencies,
  type CreateReportDraftTransaction,
} from './reportTickets.js';

const createdAt = Timestamp.fromDate(new Date('2026-09-04T00:00:00Z'));
const expiresAt = Timestamp.fromDate(new Date('2026-09-05T00:00:00Z'));
const requestKey = 'a'.repeat(64);

const snapshot = {
  listingId: 'listing-1', cardType: 'character' as const,
  cardName: '諸伏高明', cardId: '0501', rarity: 'D', listingPrice: 500, createdAt,
};

const draft = {
  status: 'draft' as const, requestKey, reporterId: 'buyer-1', targetSellerId: 'seller-1',
  listingSnapshot: snapshot, createdAt, expiresAt,
};

describe('report ticket contracts', () => {
  it('accepts only the approved categories and exact callable requests', () => {
    expect(MODERATION_REPORT_CATEGORIES).toEqual([
      'suspected_counterfeit', 'listing_mismatch', 'fraud_or_harassment',
      'prohibited_content', 'other',
    ]);
    expect(parseCreateReportDraftRequest({
      requestId: '550e8400-e29b-41d4-a716-446655440000', listingId: 'listing-1',
    })).toEqual({
      requestId: '550e8400-e29b-41d4-a716-446655440000', listingId: 'listing-1',
    });
    expect(parseSubmitReportRequest({
      reportId: 'report-1', category: 'other', description: '可疑的交易要求',
      evidencePaths: ['reportEvidence/buyer-1/report-1/0'],
    })).toEqual({
      reportId: 'report-1', category: 'other', description: '可疑的交易要求',
      evidencePaths: ['reportEvidence/buyer-1/report-1/0'],
    });
  });

  it.each([
    ['bad UUID', { requestId: 'request-1', listingId: 'listing-1' }],
    ['extra draft field', { requestId: '550e8400-e29b-41d4-a716-446655440000', listingId: 'listing-1', email: 'x@y.z' }],
  ])('rejects malformed draft request: %s', (_label, value) => {
    expect(() => parseCreateReportDraftRequest(value)).toThrow();
  });

  it.each([
    ['unknown category', { category: 'spam' }],
    ['blank description', { description: '' }],
    ['padded description', { description: ' 說明' }],
    ['long description', { description: '字'.repeat(101) }],
    ['too many evidence paths', { evidencePaths: ['a', 'b', 'c', 'd'] }],
    ['duplicate paths', { evidencePaths: ['a', 'a'] }],
    ['extra contact', { contactValue: 'private-contact' }],
  ])('rejects malformed submit request: %s', (_label, override) => {
    expect(() => parseSubmitReportRequest({
      reportId: 'report-1', category: 'other', description: '說明', evidencePaths: [],
      ...override,
    })).toThrow();
  });

  it('projects only the immutable safe Listing snapshot', () => {
    expect(projectReportListingSnapshot('listing-1', {
      status: 'active', sellerId: 'seller-1', cardType: 'character', cardName: '諸伏高明',
      cardId: '0501', rarity: 'D', listingPrice: 500, createdAt,
      contactValue: 'private-contact', imageUrls: ['https://example.test/private.jpg'],
    })).toEqual(snapshot);
    expect(JSON.stringify(snapshot)).not.toMatch(/contact|email|image/iu);
  });

  it('reads exact draft and submitted records with bounded evidence metadata', () => {
    expect(readModerationReport(draft)).toEqual(draft);
    const submitted = {
      ...draft, status: 'submitted' as const, category: 'listing_mismatch' as const,
      description: '稀有度不符', evidence: [{
        path: 'reportEvidence/buyer-1/report-1/0', contentType: 'image/png',
        size: 100, generation: '123', md5Hash: 'abc=',
      }], submittedAt: expiresAt,
    };
    expect(readModerationReport(submitted)).toEqual(submitted);
    expect(() => readModerationReport({ ...draft, reporterEmail: 'buyer@example.test' }))
      .toThrow('exact fields');
  });
});

interface DraftState {
  access: Record<string, unknown | null>;
  listings: Record<string, Record<string, unknown> | null>;
  reports: Record<string, Record<string, unknown> | null>;
  pointers: Record<string, Record<string, unknown> | null>;
  limits: Record<string, Record<string, unknown> | null>;
}

const request = {
  authUid: 'buyer-1',
  data: { requestId: '550e8400-e29b-41d4-a716-446655440000', listingId: 'listing-1' },
};

function reportableListing(overrides: Record<string, unknown> = {}) {
  return {
    status: 'active', sellerId: 'seller-1', cardType: 'character', cardName: '諸伏高明',
    cardId: '0501', rarity: 'D', listingPrice: 500, createdAt,
    contactValue: 'private-contact', imageUrls: ['https://example.test/private.jpg'],
    ...overrides,
  };
}

function draftHarness(initial: Partial<DraftState> = {}) {
  const state: DraftState = {
    access: { 'buyer-1': null },
    listings: { 'listing-1': reportableListing() },
    reports: {}, pointers: {}, limits: {}, ...initial,
  };
  const transaction: CreateReportDraftTransaction = {
    getAccountAccess: vi.fn(async (uid) => state.access[uid] ?? null),
    getListing: vi.fn(async (id) => state.listings[id] ?? null),
    getRequestPointer: vi.fn(async (key) => state.pointers[key] ?? null),
    getReport: vi.fn(async (id) => state.reports[id] ?? null),
    getDailyLimit: vi.fn(async (key) => state.limits[key] ?? null),
    createReport: vi.fn((id, data) => { state.reports[id] = data; }),
    createRequestPointer: vi.fn((key, data) => { state.pointers[key] = data; }),
    setDailyLimit: vi.fn((key, data) => { state.limits[key] = data; }),
  };
  const dependencies: CreateReportDraftDependencies = {
    now: () => new Date('2026-09-04T08:30:00.000Z'),
    randomId: () => 'report-1',
    runTransaction: async (operation) => operation(transaction),
  };
  return { state, transaction, dependencies };
}

function expectCode(operation: Promise<unknown>, code: string) {
  return expect(operation).rejects.toMatchObject({ code });
}

describe('create report draft', () => {
  it('atomically creates a private 24-hour draft, pointer, and exact UTC-day limit', async () => {
    const { state, dependencies } = draftHarness();

    const result = await createReportDraft(request, dependencies);

    expect(result).toEqual({
      reportId: 'report-1',
      expiresAt: Timestamp.fromDate(new Date('2026-09-05T08:30:00.000Z')),
    });
    expect(state.reports['report-1']).toEqual({
      status: 'draft', requestKey: expect.stringMatching(/^[0-9a-f]{64}$/u),
      reporterId: 'buyer-1', targetSellerId: 'seller-1', listingSnapshot: snapshot,
      createdAt: Timestamp.fromDate(new Date('2026-09-04T08:30:00.000Z')),
      expiresAt: Timestamp.fromDate(new Date('2026-09-05T08:30:00.000Z')),
    });
    const pointerEntries = Object.entries(state.pointers);
    expect(pointerEntries).toHaveLength(1);
    const expectedRequestKey = createHash('sha256')
      .update(`buyer-1\0${request.data.requestId}`, 'utf8').digest('hex');
    const expectedRequestIdHash = createHash('sha256')
      .update(request.data.requestId, 'utf8').digest('hex');
    expect(pointerEntries[0]).toEqual([
      expectedRequestKey,
      {
        reportId: 'report-1', reporterId: 'buyer-1',
        requestIdHash: expectedRequestIdHash,
        createdAt: Timestamp.fromDate(new Date('2026-09-04T08:30:00.000Z')),
      },
    ]);
    expect(state.limits).toEqual({
      'buyer-1_2026-09-04': {
        reporterId: 'buyer-1', utcDate: '2026-09-04', count: 1,
        createdAt: Timestamp.fromDate(new Date('2026-09-04T08:30:00.000Z')),
        updatedAt: Timestamp.fromDate(new Date('2026-09-04T08:30:00.000Z')),
      },
    });
    expect(JSON.stringify(state.reports)).not.toMatch(/contact|email|image/iu);
  });

  it('accepts a canonical active access record without requiring a Seller Profile', async () => {
    const { dependencies } = draftHarness({ access: {
      'buyer-1': { status: 'active', confirmedViolationCount: 0, updatedAt: createdAt },
    } });
    await expect(createReportDraft(request, dependencies)).resolves.toMatchObject({ reportId: 'report-1' });
  });

  it('returns the same compatible draft without consuming the daily limit again', async () => {
    const { state, dependencies } = draftHarness();
    const first = await createReportDraft(request, dependencies);
    const second = await createReportDraft(request, dependencies);

    expect(second).toEqual(first);
    expect(Object.keys(state.reports)).toHaveLength(1);
    expect(state.limits['buyer-1_2026-09-04']?.count).toBe(1);
  });

  it('allows exactly ten newly-created drafts on one UTC date and rejects the eleventh', async () => {
    const now = Timestamp.fromDate(new Date('2026-09-04T08:00:00Z'));
    const { state, dependencies } = draftHarness({ limits: {
      'buyer-1_2026-09-04': {
        reporterId: 'buyer-1', utcDate: '2026-09-04', count: 9,
        createdAt: now, updatedAt: now,
      },
    } });
    await expect(createReportDraft(request, dependencies)).resolves.toMatchObject({ reportId: 'report-1' });
    dependencies.randomId = () => 'report-2';
    await expectCode(createReportDraft({
      ...request,
      data: { ...request.data, requestId: '550e8400-e29b-41d4-a716-446655440001' },
    }, dependencies), 'resource-exhausted');
    expect(state.limits['buyer-1_2026-09-04']?.count).toBe(10);
  });

  it.each([
    ['signed out', null, {}, 'unauthenticated'],
    ['suspended reporter', 'buyer-1', { access: { 'buyer-1': {
      status: 'suspended', confirmedViolationCount: 1, updatedAt: createdAt,
      suspensionReason: 'confirmed', suspendedAt: createdAt, suspendedBy: 'admin-1',
    } } }, 'permission-denied'],
    ['missing Listing', 'buyer-1', { listings: { 'listing-1': null } }, 'not-found'],
    ['sold Listing', 'buyer-1', { listings: { 'listing-1': reportableListing({ status: 'sold_out' }) } }, 'failed-precondition'],
    ['owned Listing', 'buyer-1', { listings: { 'listing-1': reportableListing({ sellerId: 'buyer-1' }) } }, 'permission-denied'],
  ])('rejects %s', async (_label, authUid, initial, code) => {
    const { dependencies } = draftHarness(initial as Partial<DraftState>);
    await expectCode(createReportDraft({ ...request, authUid }, dependencies), code);
  });

  it('fails closed when an idempotency pointer is incompatible', async () => {
    const { state, dependencies } = draftHarness();
    const first = await createReportDraft(request, dependencies);
    const key = Object.keys(state.pointers)[0];
    state.pointers[key] = {
      reportId: first.reportId, reporterId: 'different-user',
      requestIdHash: 'b'.repeat(64), createdAt,
    };
    await expectCode(createReportDraft(request, dependencies), 'aborted');
  });

  it('sanitizes unexpected dependency failures', async () => {
    const { dependencies } = draftHarness();
    dependencies.runTransaction = async () => { throw new Error('secret database payload'); };
    await expect(createReportDraft(request, dependencies)).rejects.toMatchObject({
      code: 'unavailable', message: '目前無法建立檢舉，請稍後再試。',
    });
  });
});
