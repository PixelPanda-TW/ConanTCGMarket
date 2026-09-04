import { Timestamp } from 'firebase-admin/firestore';
import { readModerationReport, ReportTicketError } from './reportTickets.js';

const PAGE_SIZE = 50;
const MAX_PAGES = 10;

export interface ExpiredReportCandidate {
  id: string;
  data: unknown;
}

export interface ReportCleanupTransaction {
  getReport(id: string): Promise<unknown | null>;
  deleteReport(id: string): void;
  deleteRequestPointer(key: string): void;
}

export interface ReportCleanupDependencies {
  now(): Date;
  listExpiredDrafts(input: {
    before: Timestamp;
    after: { expiresAt: Timestamp; id: string } | null;
    limit: number;
  }): Promise<{
    items: ExpiredReportCandidate[];
    nextAfter: { expiresAt: Timestamp; id: string } | null;
  }>;
  deleteEvidence(path: string): Promise<void>;
  isObjectNotFound(error: unknown): boolean;
  runTransaction<T>(
    operation: (transaction: ReportCleanupTransaction) => Promise<T>,
  ): Promise<T>;
  log(entry: {
    event: 'report_cleanup_deleted' | 'report_cleanup_failed' | 'report_cleanup_skipped';
    reportId: string;
    outcomeCode: string;
  }): void;
}

export interface ReportCleanupResult {
  scanned: number;
  deleted: number;
  failed: number;
  pages: number;
}

function readCurrentExpiredDraft(value: unknown, before: Timestamp) {
  if (value === null) return null;
  const report = readModerationReport(value);
  if (report.status !== 'draft' || report.expiresAt.toMillis() > before.toMillis()) return null;
  return report;
}

export async function cleanupExpiredReportDrafts(
  dependencies: ReportCleanupDependencies,
): Promise<ReportCleanupResult> {
  const nowDate = dependencies.now();
  if (!(nowDate instanceof Date) || Number.isNaN(nowDate.valueOf())) {
    throw new ReportTicketError('unavailable', '無法執行檢舉草稿清理。');
  }
  const before = Timestamp.fromDate(nowDate);
  const result: ReportCleanupResult = { scanned: 0, deleted: 0, failed: 0, pages: 0 };
  let after: { expiresAt: Timestamp; id: string } | null = null;

  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
    const page = await dependencies.listExpiredDrafts({ before, after, limit: PAGE_SIZE });
    result.pages += 1;
    for (const candidate of page.items.slice(0, PAGE_SIZE)) {
      result.scanned += 1;
      try {
        const current = await dependencies.runTransaction(async (transaction) => (
          readCurrentExpiredDraft(await transaction.getReport(candidate.id), before)
        ));
        if (!current) {
          dependencies.log({
            event: 'report_cleanup_skipped', reportId: candidate.id, outcomeCode: 'not_expired_draft',
          });
          continue;
        }

        for (let slot = 0; slot < 3; slot += 1) {
          const path = `reportEvidence/${current.reporterId}/${candidate.id}/${slot}`;
          try {
            await dependencies.deleteEvidence(path);
          } catch (error) {
            if (!dependencies.isObjectNotFound(error)) throw error;
          }
        }

        const deleted = await dependencies.runTransaction(async (transaction) => {
          const latest = readCurrentExpiredDraft(
            await transaction.getReport(candidate.id), before,
          );
          if (!latest) return false;
          transaction.deleteReport(candidate.id);
          transaction.deleteRequestPointer(latest.requestKey);
          return true;
        });
        if (deleted) {
          result.deleted += 1;
          dependencies.log({
            event: 'report_cleanup_deleted', reportId: candidate.id, outcomeCode: 'deleted',
          });
        } else {
          dependencies.log({
            event: 'report_cleanup_skipped', reportId: candidate.id, outcomeCode: 'changed',
          });
        }
      } catch {
        result.failed += 1;
        dependencies.log({
          event: 'report_cleanup_failed', reportId: candidate.id, outcomeCode: 'dependency_error',
        });
      }
    }

    if (page.nextAfter === null) break;
    if (after && page.nextAfter.id === after.id
      && page.nextAfter.expiresAt.isEqual(after.expiresAt)) break;
    after = page.nextAfter;
  }
  return result;
}
