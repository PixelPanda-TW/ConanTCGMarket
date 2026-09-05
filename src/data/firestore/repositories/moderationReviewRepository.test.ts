import { beforeEach, describe, expect, it, vi } from 'vitest';

const functions = vi.hoisted(() => ({
  callableByName: new Map<string, ReturnType<typeof vi.fn>>(),
  httpsCallable: vi.fn((_client: unknown, name: string) => (
    functions.callableByName.get(name) ?? vi.fn()
  )),
}));
const firebaseApp = vi.hoisted(() => ({ functionsClient: { type: 'functions' } }));

vi.mock('firebase/functions', () => functions);
vi.mock('../../../lib/firebase/app', () => firebaseApp);

import {
  decideModerationCase,
  getModerationCase,
  getModerationEvidence,
  listModerationCases,
} from './moderationReviewRepository';

const snapshot = {
  listingId: 'listing-1', cardType: 'character', cardName: '江戶川柯南',
  cardId: '0101', rarity: 'SR', listingPrice: 1200, createdAt: 1_788_192_000_000,
};
const summary = {
  reportId: 'report-2', status: 'open', category: 'listing_mismatch',
  targetSellerId: 'seller-1', listingSnapshot: snapshot, openedAt: 1_788_278_400_000,
};
const detail = {
  ...summary,
  description: '圖片與商品內容不符', reporterId: 'buyer-1',
  submittedAt: 1_788_278_400_000,
  evidence: [{ slot: 0, contentType: 'image/png', size: 3 }],
  account: { status: 'active', confirmedViolationCount: 1, suspensionEligible: false },
  accountModeration: { operation: null, history: [] },
};

describe('moderation review repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    functions.callableByName.clear();
    for (const name of [
      'listModerationCases', 'getModerationCase', 'getModerationEvidence',
      'decideModerationCase',
    ]) functions.callableByName.set(name, vi.fn());
  });

  it('lists through the exact callable payload and converts wire dates', async () => {
    const callable = functions.callableByName.get('listModerationCases')!;
    callable.mockResolvedValue({ data: {
      cases: [summary],
      nextCursor: { openedAt: summary.openedAt, key: summary.reportId },
    } });

    await expect(listModerationCases({
      status: 'open', limit: 1,
      cursor: { openedAt: new Date(1_788_364_800_000), key: 'report-3' },
    })).resolves.toEqual({
      cases: [{
        ...summary,
        listingSnapshot: { ...snapshot, createdAt: new Date(snapshot.createdAt) },
        openedAt: new Date(summary.openedAt),
      }],
      nextCursor: { openedAt: new Date(summary.openedAt), key: 'report-2' },
    });
    expect(callable).toHaveBeenCalledWith({
      status: 'open', limit: 1,
      cursor: { openedAt: 1_788_364_800_000, key: 'report-3' },
    });
  });

  it('uses bounded list defaults and rejects malformed local requests before SDK calls', async () => {
    functions.callableByName.get('listModerationCases')!.mockResolvedValue({
      data: { cases: [], nextCursor: null },
    });
    await listModerationCases({ status: 'all' });
    expect(functions.callableByName.get('listModerationCases')).toHaveBeenCalledWith({
      status: 'all', limit: 20, cursor: null,
    });

    for (const input of [
      { status: 'unknown' },
      { status: 'open', limit: 0 },
      { status: 'open', limit: 51 },
      { status: 'open', extra: true },
      { status: 'open', cursor: { openedAt: new Date('invalid'), key: 'report-1' } },
    ]) {
      vi.clearAllMocks();
      await expect(listModerationCases(input as never)).rejects.toThrow('request is invalid');
      expect(functions.httpsCallable).not.toHaveBeenCalled();
    }
  });

  it('gets exact detail and converts every wire date', async () => {
    functions.callableByName.get('getModerationCase')!.mockResolvedValue({ data: detail });
    const result = await getModerationCase('report-2');
    expect(result.openedAt).toEqual(new Date(detail.openedAt));
    expect(result.submittedAt).toEqual(new Date(detail.submittedAt));
    expect(result.listingSnapshot.createdAt).toEqual(new Date(snapshot.createdAt));
    expect(functions.callableByName.get('getModerationCase'))
      .toHaveBeenCalledWith({ reportId: 'report-2' });
  });

  it('converts bounded account moderation operation and audit dates', async () => {
    const data = {
      ...detail,
      account: {
        status: 'suspended', confirmedViolationCount: 2, suspensionEligible: true,
        suspensionReason: '重複違規', suspendedAt: 1_788_278_401_000,
        suspendedBy: 'admin-1', suspensionActionId: 'action-1',
      },
      accountModeration: {
        operation: {
          actionId: 'action-1', status: 'suspended', targetUid: 'seller-1',
          sourceReportId: 'report-2', requestedBy: 'admin-1', reason: '重複違規',
          confirmedViolationCount: 2, hiddenListingCount: 3,
          createdAt: 1_788_278_400_000, updatedAt: 1_788_278_402_000,
          completedAt: 1_788_278_402_000,
        },
        history: [{
          eventId: 'event-2', type: 'suspension_completed', targetUid: 'seller-1',
          suspensionActionId: 'action-1', sourceReportId: 'report-2', actorUid: 'admin-1',
          at: 1_788_278_402_000, hiddenListingCount: 3,
        }, {
          eventId: 'event-1', type: 'suspension_requested', targetUid: 'seller-1',
          suspensionActionId: 'action-1', sourceReportId: 'report-2', actorUid: 'admin-1',
          at: 1_788_278_400_000, reason: '重複違規', confirmedViolationCount: 2,
        }],
      },
    };
    functions.callableByName.get('getModerationCase')!.mockResolvedValue({ data });
    const result = await getModerationCase('report-2');
    expect(result.account.status === 'suspended' && result.account.suspendedAt)
      .toEqual(new Date(1_788_278_401_000));
    expect(result.accountModeration.operation?.updatedAt)
      .toEqual(new Date(1_788_278_402_000));
    expect(result.accountModeration.history.map(({ at }) => at)).toEqual([
      new Date(1_788_278_402_000), new Date(1_788_278_400_000),
    ]);
  });

  it.each([
    ['summary privacy leak', { cases: [{ ...summary, email: 'private@example.test' }], nextCursor: null }],
    ['detail path leak', { ...detail, evidence: [{ ...detail.evidence[0], path: 'secret/path' }] }],
    ['detail contact leak', { ...detail, contact: { discord: 'private' } }],
    ['unsafe date', { ...detail, submittedAt: Number.MAX_SAFE_INTEGER + 1 }],
  ])('rejects malformed or over-broad responses: %s', async (label, data) => {
    if (label.startsWith('summary')) {
      functions.callableByName.get('listModerationCases')!.mockResolvedValue({ data });
      await expect(listModerationCases({ status: 'all' })).rejects.toThrow('invalid moderation case page');
    } else {
      functions.callableByName.get('getModerationCase')!.mockResolvedValue({ data });
      await expect(getModerationCase('report-2')).rejects.toThrow('invalid moderation case detail');
    }
  });

  it('parses an exact evidence object after validating MIME, canonical base64, and byte size', async () => {
    const callable = functions.callableByName.get('getModerationEvidence')!;
    callable.mockResolvedValue({ data: {
      contentType: 'image/png', size: 3, dataBase64: 'AQID',
    } });
    await expect(getModerationEvidence({ reportId: 'report-2', slot: 0 })).resolves.toEqual({
      contentType: 'image/png', size: 3, dataBase64: 'AQID',
    });
    expect(callable).toHaveBeenCalledWith({ reportId: 'report-2', slot: 0 });
  });

  it.each([
    { contentType: 'text/html', size: 3, dataBase64: 'AQID' },
    { contentType: 'image/png', size: 3, dataBase64: 'not base64' },
    { contentType: 'image/png', size: 4, dataBase64: 'AQID' },
    { contentType: 'image/png', size: 3, dataBase64: 'AQID', path: 'secret/path' },
    { contentType: 'image/png', size: 3, dataBase64: 'AQID', hash: 'secret' },
  ])('rejects malformed evidence response %#', async (data) => {
    functions.callableByName.get('getModerationEvidence')!.mockResolvedValue({ data });
    await expect(getModerationEvidence({ reportId: 'report-2', slot: 0 }))
      .rejects.toThrow('invalid moderation evidence response');
  });

  it('sends an exact decision and validates the trusted result', async () => {
    const callable = functions.callableByName.get('decideModerationCase')!;
    callable.mockResolvedValue({ data: {
      reportId: 'report-2', status: 'confirmed',
      resultingConfirmedViolationCount: 2, suspensionEligible: true,
    } });
    await expect(decideModerationCase({
      reportId: 'report-2', decision: 'confirmed', rationale: '證據與商品不符',
    })).resolves.toEqual({
      reportId: 'report-2', status: 'confirmed',
      resultingConfirmedViolationCount: 2, suspensionEligible: true,
    });
    expect(callable).toHaveBeenCalledWith({
      reportId: 'report-2', decision: 'confirmed', rationale: '證據與商品不符',
    });
  });

  it('rejects invalid detail/evidence/decision input before creating callables', async () => {
    await expect(getModerationCase(' report-2')).rejects.toThrow('request is invalid');
    await expect(getModerationEvidence({ reportId: 'report-2', slot: 3 as never }))
      .rejects.toThrow('request is invalid');
    await expect(decideModerationCase({
      reportId: 'report-2', decision: 'dismissed', rationale: ' ',
    })).rejects.toThrow('request is invalid');
    expect(functions.httpsCallable).not.toHaveBeenCalled();
  });

  it('maps callable failures to generic review errors without exposing server text', async () => {
    functions.callableByName.get('getModerationCase')!
      .mockRejectedValue(new Error('secret storage path and reporter email'));
    await expect(getModerationCase('report-2')).rejects.toThrow(
      '審查服務目前無法使用，請稍後再試。',
    );
  });

  it('preserves only a sanitized not-found signal for the detail route', async () => {
    functions.callableByName.get('getModerationCase')!.mockRejectedValue(
      Object.assign(new Error('private report and seller data'), { code: 'functions/not-found' }),
    );
    const error = await getModerationCase('report-2').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error & { code?: string }).code).toBe('not-found');
    expect((error as Error).message).not.toContain('private');
  });
});
