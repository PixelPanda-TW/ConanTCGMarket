import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import {
  cleanupExpiredReportDrafts,
  type ReportCleanupDependencies,
  type ReportCleanupTransaction,
} from './reportCleanup.js';

const now = new Date('2026-09-06T00:00:00.000Z');
const expiredAt = Timestamp.fromDate(new Date('2026-09-05T00:00:00.000Z'));
const createdAt = Timestamp.fromDate(new Date('2026-09-04T00:00:00.000Z'));

function draft(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    data: {
      status: 'draft', requestKey: (id === 'report-1' ? 'a' : 'b').repeat(64),
      reporterId: 'buyer-1', targetSellerId: 'seller-1',
      listingSnapshot: {
        listingId: 'listing-1', cardType: 'character', cardName: '諸伏高明',
        cardId: '0501', rarity: 'D', listingPrice: 500, createdAt,
      },
      createdAt, expiresAt: expiredAt, ...overrides,
    },
  };
}

function harness(items = [draft('report-1')]) {
  const reports = new Map(items.map((item) => [item.id, item.data]));
  const pointers = new Set(items.map((item) => String(item.data.requestKey)));
  const deletedObjects: string[] = [];
  const logs: Record<string, unknown>[] = [];
  const transaction: ReportCleanupTransaction = {
    getReport: vi.fn(async (id) => reports.get(id) ?? null),
    deleteReport: vi.fn((id) => { reports.delete(id); }),
    deleteRequestPointer: vi.fn((key) => { pointers.delete(key); }),
  };
  const dependencies: ReportCleanupDependencies = {
    now: () => now,
    listExpiredDrafts: vi.fn(async ({ afterId }) => ({
      items: afterId === null ? items : [], nextAfterId: null,
    })),
    deleteEvidence: vi.fn(async (path) => { deletedObjects.push(path); }),
    isObjectNotFound: (error) => error instanceof Error && error.message === 'not-found',
    runTransaction: async (operation) => operation(transaction),
    log: (entry) => { logs.push(entry); },
  };
  return { reports, pointers, deletedObjects, logs, transaction, dependencies };
}

describe('expired report draft cleanup', () => {
  it('deletes only three canonical slots before atomically removing draft and pointer', async () => {
    const { reports, pointers, deletedObjects, dependencies } = harness();
    await expect(cleanupExpiredReportDrafts(dependencies)).resolves.toEqual({
      scanned: 1, deleted: 1, failed: 0, pages: 1,
    });
    expect(deletedObjects).toEqual([
      'reportEvidence/buyer-1/report-1/0',
      'reportEvidence/buyer-1/report-1/1',
      'reportEvidence/buyer-1/report-1/2',
    ]);
    expect(reports.size).toBe(0);
    expect(pointers.size).toBe(0);
  });

  it('treats missing evidence objects as an idempotent success', async () => {
    const { reports, dependencies } = harness();
    dependencies.deleteEvidence = vi.fn(async () => { throw new Error('not-found'); });
    await expect(cleanupExpiredReportDrafts(dependencies)).resolves.toMatchObject({ deleted: 1, failed: 0 });
    expect(reports.size).toBe(0);
  });

  it.each([
    ['submitted report', { status: 'submitted', category: 'other', description: '說明', evidence: [], submittedAt: createdAt }],
    ['unexpired draft', { expiresAt: Timestamp.fromDate(new Date('2026-09-07T00:00:00Z')) }],
  ])('preserves %s and its evidence', async (_label, override) => {
    const item = draft('report-1', override);
    const { reports, pointers, deletedObjects, dependencies } = harness([item]);
    await expect(cleanupExpiredReportDrafts(dependencies)).resolves.toMatchObject({ deleted: 0 });
    expect(reports.has('report-1')).toBe(true);
    expect(pointers.size).toBe(1);
    expect(deletedObjects).toEqual([]);
  });

  it('continues after a partial object failure and retains that draft and pointer', async () => {
    const { reports, pointers, dependencies, logs } = harness([draft('report-1'), draft('report-2')]);
    dependencies.deleteEvidence = vi.fn(async (path) => {
      if (path === 'reportEvidence/buyer-1/report-1/1') throw new Error('storage unavailable with payload');
    });
    await expect(cleanupExpiredReportDrafts(dependencies)).resolves.toEqual({
      scanned: 2, deleted: 1, failed: 1, pages: 1,
    });
    expect(reports.has('report-1')).toBe(true);
    expect(pointers.has(String(draft('report-1').data.requestKey))).toBe(true);
    expect(reports.has('report-2')).toBe(false);
    expect(JSON.stringify(logs)).not.toMatch(/payload|description|evidence/iu);
  });

  it('uses bounded page size and stops after ten pages even if a source claims more', async () => {
    const { dependencies } = harness([]);
    dependencies.listExpiredDrafts = vi.fn(async ({ afterId }) => {
      const index = afterId === null ? 0 : Number(afterId.slice(1)) + 1;
      return { items: [], nextAfterId: `p${index}` };
    });
    await expect(cleanupExpiredReportDrafts(dependencies)).resolves.toMatchObject({ pages: 10 });
    expect(dependencies.listExpiredDrafts).toHaveBeenCalledTimes(10);
    expect(dependencies.listExpiredDrafts).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));
  });

  it('does not delete a report that changed after evidence cleanup', async () => {
    const { reports, pointers, transaction, dependencies } = harness();
    vi.mocked(transaction.getReport)
      .mockResolvedValueOnce(draft('report-1').data)
      .mockResolvedValueOnce({ ...draft('report-1').data, status: 'submitted', category: 'other', description: '說明', evidence: [], submittedAt: createdAt });
    await expect(cleanupExpiredReportDrafts(dependencies)).resolves.toMatchObject({ deleted: 0 });
    expect(reports.has('report-1')).toBe(true);
    expect(pointers.size).toBe(1);
  });
});
