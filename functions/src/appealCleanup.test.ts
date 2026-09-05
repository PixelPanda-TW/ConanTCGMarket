import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import {
  cleanupExpiredAppealDrafts,
  type AppealCleanupDependencies,
} from './appealCleanup.js';

const now = new Date('2026-09-07T00:00:00Z');
const draft = '123e4567-e89b-42d3-a456-426614174000';
const path = `account-appeal-evidence/seller-1/action-1/${draft}/0`;

function harness() {
  const removed: string[] = [];
  const dependencies: AppealCleanupDependencies = {
    now: () => now,
    listExpiredDraftEvidence: vi.fn(async ({ after }) => ({
      items: after ? [] : [{ path, generation: '123', createdAt: new Date('2026-09-05T00:00:00Z') }],
      nextAfter: null,
    })),
    getAppealForAction: vi.fn(async () => null),
    deleteEvidence: vi.fn(async (objectPath) => { removed.push(objectPath); }),
    isObjectNotFound: () => false,
    log: vi.fn(),
  };
  return { dependencies, removed };
}

describe('appeal draft cleanup', () => {
  it('deletes only expired unbound canonical draft objects', async () => {
    const { dependencies, removed } = harness();
    await expect(cleanupExpiredAppealDrafts(dependencies)).resolves.toEqual({
      scanned: 1, deleted: 1, preserved: 0, failed: 0, pages: 1,
    });
    expect(removed).toEqual([path]);
  });

  it('preserves evidence bound to a submitted appeal by draft, slot, and generation', async () => {
    const { dependencies, removed } = harness();
    dependencies.getAppealForAction = vi.fn(async () => ({
      appealId: 'appeal-1', status: 'submitted', targetUid: 'seller-1',
      suspensionActionId: 'action-1', draftId: draft,
      statement: '申訴內容與交易說明。'.repeat(20),
      evidence: [{ slot: 0, generation: '123', contentType: 'image/png', size: 10 }],
      requestKey: 'a'.repeat(64), submittedAt: Timestamp.fromMillis(1),
      updatedAt: Timestamp.fromMillis(1),
    }));
    await expect(cleanupExpiredAppealDrafts(dependencies)).resolves.toMatchObject({ preserved: 1 });
    expect(removed).toEqual([]);
  });

  it('retains malformed or dependency-failed candidates and bounds pagination', async () => {
    const { dependencies } = harness();
    dependencies.getAppealForAction = vi.fn(async () => ({ malformed: true }));
    await expect(cleanupExpiredAppealDrafts(dependencies)).resolves.toMatchObject({ failed: 1, deleted: 0 });

    dependencies.getAppealForAction = vi.fn(async () => null);
    dependencies.listExpiredDraftEvidence = vi.fn(async ({ after }) => ({
      items: [], nextAfter: after ? `${Number(after) + 1}` : '1',
    }));
    await expect(cleanupExpiredAppealDrafts(dependencies)).resolves.toMatchObject({ pages: 10 });
    expect(dependencies.listExpiredDraftEvidence).toHaveBeenCalledTimes(10);
  });
});
