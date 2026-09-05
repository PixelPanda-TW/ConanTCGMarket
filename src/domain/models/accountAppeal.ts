export const ACCOUNT_APPEAL_STATUSES = ['submitted', 'dismissed', 'approved'] as const;
export type AccountAppealStatus = typeof ACCOUNT_APPEAL_STATUSES[number];
export type AccountAppealEvidenceType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface AccountAppealEvidenceSummary {
  slot: 0 | 1 | 2;
  contentType: AccountAppealEvidenceType;
  size: number;
}

interface AppealBase {
  appealId: string; targetUid: string; suspensionActionId: string; statement: string;
  evidence: AccountAppealEvidenceSummary[]; submittedAt: Date; updatedAt: Date;
}
export type AccountAppealDetail =
  | (AppealBase & { status: 'submitted' })
  | (AppealBase & { status: 'dismissed' | 'approved'; decidedAt: Date;
      decidedBy: string; decisionRationale: string });

type SummaryBase = Omit<AppealBase, 'statement' | 'evidence'> & { evidenceCount: number };
export type AccountAppealSummary =
  | (SummaryBase & { status: 'submitted' })
  | (SummaryBase & { status: 'dismissed' | 'approved'; decidedAt: Date });
export interface AccountAppealPage { appeals: AccountAppealSummary[];
  nextCursor: { submittedAt: Date; key: string } | null }

const contentTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, fields: readonly string[]) {
  const keys = Object.keys(value);
  if (keys.length !== fields.length || !fields.every((field) => keys.includes(field))) {
    throw new Error('Account appeal requires exact fields.');
  }
}
function id(value: unknown, maximum = 200): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
    && value === value.trim();
}
function date(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.valueOf());
}
function validateCommon(value: Record<string, unknown>, summary: boolean) {
  if (!id(value.appealId) || !id(value.targetUid, 128) || !id(value.suspensionActionId)
    || !date(value.submittedAt) || !date(value.updatedAt)
    || value.updatedAt.valueOf() < value.submittedAt.valueOf()) {
    throw new Error('Account appeal identity or dates are invalid.');
  }
  if (summary) {
    if (!Number.isSafeInteger(value.evidenceCount)
      || (value.evidenceCount as number) < 0 || (value.evidenceCount as number) > 3) {
      throw new Error('Account appeal evidence count is invalid.');
    }
  } else {
    if (typeof value.statement !== 'string' || value.statement !== value.statement.trim()
      || value.statement.length < 100 || value.statement.length > 2000
      || !Array.isArray(value.evidence) || value.evidence.length > 3) {
      throw new Error('Account appeal statement or evidence is invalid.');
    }
    let previous = -1;
    for (const evidence of value.evidence) {
      if (!record(evidence)) throw new Error('Account appeal evidence is invalid.');
      exact(evidence, ['slot', 'contentType', 'size']);
      if (!Number.isInteger(evidence.slot) || (evidence.slot as number) <= previous
        || (evidence.slot as number) > 2 || !contentTypes.has(String(evidence.contentType))
        || !Number.isSafeInteger(evidence.size) || (evidence.size as number) < 1
        || (evidence.size as number) > 5 * 1024 * 1024) {
        throw new Error('Account appeal evidence is invalid.');
      }
      previous = evidence.slot as number;
    }
  }
  if (value.status !== 'submitted') {
    if (!date(value.decidedAt) || value.decidedAt.valueOf() < value.submittedAt.valueOf()
      || value.updatedAt.valueOf() < value.decidedAt.valueOf()) {
      throw new Error('Account appeal decision is invalid.');
    }
    if (!summary && (!id(value.decidedBy, 128)
      || typeof value.decisionRationale !== 'string'
      || value.decisionRationale !== value.decisionRationale.trim()
      || value.decisionRationale.length < 1 || value.decisionRationale.length > 1000)) {
      throw new Error('Account appeal decision is invalid.');
    }
  }
}
function fields(status: unknown, summary: boolean): string[] {
  if (!ACCOUNT_APPEAL_STATUSES.includes(status as AccountAppealStatus)) return [];
  const base = ['appealId', 'status', 'targetUid', 'suspensionActionId',
    ...(summary ? ['evidenceCount'] : ['statement', 'evidence']), 'submittedAt', 'updatedAt'];
  return status === 'submitted' ? base
    : [...base, 'decidedAt', ...(summary ? [] : ['decidedBy', 'decisionRationale'])];
}
export function validateAccountAppealDetail(value: unknown): asserts value is AccountAppealDetail {
  if (!record(value)) throw new Error('Account appeal must be an object.');
  exact(value, fields(value.status, false));
  validateCommon(value, false);
}
function validateSummary(value: unknown): asserts value is AccountAppealSummary {
  if (!record(value)) throw new Error('Account appeal summary must be an object.');
  exact(value, fields(value.status, true));
  validateCommon(value, true);
}
export function validateAccountAppealPage(value: unknown, requestedLimit: number): void {
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 50
    || !record(value)) throw new Error('Account appeal page is invalid.');
  exact(value, ['appeals', 'nextCursor']);
  if (!Array.isArray(value.appeals) || value.appeals.length > requestedLimit) {
    throw new Error('Account appeal page is invalid.');
  }
  value.appeals.forEach(validateSummary);
  for (let index = 1; index < value.appeals.length; index += 1) {
    const a = value.appeals[index - 1] as AccountAppealSummary;
    const b = value.appeals[index] as AccountAppealSummary;
    if (a.submittedAt.valueOf() < b.submittedAt.valueOf()
      || (a.submittedAt.valueOf() === b.submittedAt.valueOf()
        && a.appealId.localeCompare(b.appealId) <= 0)) {
      throw new Error('Account appeal page order is invalid.');
    }
  }
  if (value.nextCursor === null) return;
  if (!record(value.nextCursor)) throw new Error('Account appeal cursor is invalid.');
  exact(value.nextCursor, ['submittedAt', 'key']);
  const last = value.appeals.at(-1) as AccountAppealSummary | undefined;
  if (value.appeals.length !== requestedLimit || !last || !date(value.nextCursor.submittedAt)
    || !id(value.nextCursor.key)
    || value.nextCursor.submittedAt.valueOf() !== last.submittedAt.valueOf()
    || value.nextCursor.key !== last.appealId) throw new Error('Account appeal cursor is invalid.');
}
