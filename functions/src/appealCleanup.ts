import { readStoredAccountAppeal } from './accountAppeals.js';

const PAGE_SIZE = 50;
const MAX_PAGES = 10;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface AppealDraftEvidenceCandidate {
  path: string;
  generation: string;
  createdAt: Date;
}
export interface AppealCleanupDependencies {
  now(): Date;
  listExpiredDraftEvidence(input: {
    before: Date; after: string | null; limit: number;
  }): Promise<{ items: AppealDraftEvidenceCandidate[]; nextAfter: string | null }>;
  getAppealForAction(actionId: string): Promise<unknown | null>;
  deleteEvidence(path: string, generation: string): Promise<void>;
  isObjectNotFound(error: unknown): boolean;
  log(entry: { event: 'appeal_cleanup_deleted' | 'appeal_cleanup_preserved'
    | 'appeal_cleanup_failed'; outcomeCode: string }): void;
}
export interface AppealCleanupResult {
  scanned: number; deleted: number; preserved: number; failed: number; pages: number;
}

function parsePath(path: string) {
  const match = /^account-appeal-evidence\/([^/]{1,128})\/([^/]{1,200})\/([0-9a-f-]{36})\/([0-2])$/iu
    .exec(path);
  if (!match) throw new Error('Malformed appeal draft path.');
  return { targetUid: match[1], actionId: match[2], draftId: match[3], slot: Number(match[4]) };
}

export async function cleanupExpiredAppealDrafts(
  dependencies: AppealCleanupDependencies,
): Promise<AppealCleanupResult> {
  const now = dependencies.now();
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) {
    throw new Error('Appeal cleanup clock is unavailable.');
  }
  const before = new Date(now.valueOf() - MAX_AGE_MS);
  const result: AppealCleanupResult = {
    scanned: 0, deleted: 0, preserved: 0, failed: 0, pages: 0,
  };
  let after: string | null = null;
  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
    const page = await dependencies.listExpiredDraftEvidence({ before, after, limit: PAGE_SIZE });
    result.pages += 1;
    for (const candidate of page.items.slice(0, PAGE_SIZE)) {
      result.scanned += 1;
      try {
        if (!(candidate.createdAt instanceof Date) || Number.isNaN(candidate.createdAt.valueOf())
          || candidate.createdAt.valueOf() > before.valueOf()
          || !/^[1-9][0-9]{0,30}$/u.test(candidate.generation)) {
          throw new Error('Malformed appeal evidence metadata.');
        }
        const identity = parsePath(candidate.path);
        const rawAppeal = await dependencies.getAppealForAction(identity.actionId);
        if (rawAppeal !== null) {
          const appeal = readStoredAccountAppeal(rawAppeal);
          const bound = appeal.targetUid === identity.targetUid
            && appeal.suspensionActionId === identity.actionId
            && appeal.draftId === identity.draftId
            && appeal.evidence.some((item) => (
              item.slot === identity.slot && item.generation === candidate.generation
            ));
          if (bound) {
            result.preserved += 1;
            dependencies.log({ event: 'appeal_cleanup_preserved', outcomeCode: 'submitted' });
            continue;
          }
        }
        try {
          await dependencies.deleteEvidence(candidate.path, candidate.generation);
        } catch (error) {
          if (!dependencies.isObjectNotFound(error)) throw error;
        }
        result.deleted += 1;
        dependencies.log({ event: 'appeal_cleanup_deleted', outcomeCode: 'deleted' });
      } catch {
        result.failed += 1;
        dependencies.log({ event: 'appeal_cleanup_failed', outcomeCode: 'dependency_error' });
      }
    }
    if (page.nextAfter === null || page.nextAfter === after) break;
    after = page.nextAfter;
  }
  return result;
}
