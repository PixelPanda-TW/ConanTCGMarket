import { Timestamp } from 'firebase-admin/firestore';

export type AccountAppealErrorCode = 'unauthenticated' | 'permission-denied'
  | 'invalid-argument' | 'failed-precondition' | 'already-exists' | 'aborted' | 'unavailable';
export class AccountAppealError extends Error {
  constructor(public readonly code: AccountAppealErrorCode, message: string) {
    super(message); this.name = 'AccountAppealError';
  }
}
export const ACCOUNT_APPEAL_STATUSES = ['submitted', 'dismissed', 'approved'] as const;
export const ACCOUNT_APPEAL_DECISIONS = ['dismissed', 'approved'] as const;
export const ACCOUNT_APPEAL_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const key = /^[0-9a-f]{64}$/u;

export interface AccountAppealEvidenceInput { slot: 0 | 1 | 2; generation: string;
  contentType: typeof ACCOUNT_APPEAL_CONTENT_TYPES[number]; size: number }
export interface AccountAppealSubmissionRequest { suspensionActionId: string; requestId: string;
  draftId: string; statement: string; evidence: AccountAppealEvidenceInput[] }
export interface AccountAppealDecisionRequest { appealId: string; requestId: string;
  decision: typeof ACCOUNT_APPEAL_DECISIONS[number]; rationale: string }

type StoredBase = { appealId: string; targetUid: string; suspensionActionId: string;
  statement: string; evidence: AccountAppealEvidenceInput[]; requestKey: string;
  submittedAt: Timestamp; updatedAt: Timestamp };
export type StoredAccountAppeal =
  | (StoredBase & { status: 'submitted' })
  | (StoredBase & { status: 'dismissed' | 'approved'; decidedAt: Timestamp;
      decidedBy: string; decisionRationale: string; decisionRequestKey: string });

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, fields: readonly string[]) {
  const keys = Object.keys(value);
  if (keys.length !== fields.length || !fields.every((field) => keys.includes(field))) invalid();
}
function invalid(): never { throw new AccountAppealError('invalid-argument', '請檢查申訴資料。'); }
function malformed(): never { throw new AccountAppealError('failed-precondition', '申訴記錄無法使用。'); }
function id(value: unknown, maximum = 200): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
    && value === value.trim();
}
function validStatement(value: unknown): value is string {
  return typeof value === 'string' && value === value.trim()
    && value.length >= 100 && value.length <= 2000;
}
function rationale(value: unknown): value is string {
  return typeof value === 'string' && value === value.trim()
    && value.length >= 1 && value.length <= 1000;
}
function evidence(value: unknown): value is AccountAppealEvidenceInput[] {
  if (!Array.isArray(value) || value.length > 3) return false;
  let previous = -1;
  return value.every((item) => {
    if (!record(item)) return false;
    try { exact(item, ['slot', 'generation', 'contentType', 'size']); } catch { return false; }
    const valid = Number.isInteger(item.slot) && (item.slot as number) > previous
      && (item.slot as number) <= 2 && typeof item.generation === 'string'
      && /^[1-9][0-9]{0,30}$/u.test(item.generation)
      && ACCOUNT_APPEAL_CONTENT_TYPES.includes(item.contentType as never)
      && Number.isSafeInteger(item.size) && (item.size as number) >= 1
      && (item.size as number) <= 5 * 1024 * 1024;
    if (valid) previous = item.slot as number;
    return valid;
  });
}
export function parseAccountAppealSubmissionRequest(value: unknown): AccountAppealSubmissionRequest {
  if (!record(value)) return invalid();
  exact(value, ['suspensionActionId', 'requestId', 'draftId', 'statement', 'evidence']);
  if (!id(value.suspensionActionId) || typeof value.requestId !== 'string'
    || !uuid.test(value.requestId) || typeof value.draftId !== 'string'
    || !uuid.test(value.draftId) || !validStatement(value.statement) || !evidence(value.evidence)) {
    return invalid();
  }
  return value as unknown as AccountAppealSubmissionRequest;
}
export function parseAccountAppealDecisionRequest(value: unknown): AccountAppealDecisionRequest {
  if (!record(value)) return invalid();
  exact(value, ['appealId', 'requestId', 'decision', 'rationale']);
  if (!id(value.appealId) || typeof value.requestId !== 'string' || !uuid.test(value.requestId)
    || !ACCOUNT_APPEAL_DECISIONS.includes(value.decision as never) || !rationale(value.rationale)) {
    return invalid();
  }
  return value as unknown as AccountAppealDecisionRequest;
}
function timestamp(value: unknown): value is Timestamp {
  return value instanceof Timestamp && Number.isSafeInteger(value.toMillis()) && value.toMillis() >= 0;
}
export function readStoredAccountAppeal(value: unknown): StoredAccountAppeal {
  if (!record(value) || !ACCOUNT_APPEAL_STATUSES.includes(value.status as never)) return malformed();
  const base = ['appealId', 'status', 'targetUid', 'suspensionActionId', 'statement', 'evidence',
    'requestKey', 'submittedAt', 'updatedAt'];
  const extras = value.status === 'submitted' ? []
    : ['decidedAt', 'decidedBy', 'decisionRationale', 'decisionRequestKey'];
  try { exact(value, [...base, ...extras]); } catch { return malformed(); }
  if (!id(value.appealId) || !id(value.targetUid, 128) || !id(value.suspensionActionId)
    || !validStatement(value.statement) || !evidence(value.evidence)
    || typeof value.requestKey !== 'string' || !key.test(value.requestKey)
    || !timestamp(value.submittedAt) || !timestamp(value.updatedAt)
    || value.updatedAt.toMillis() < value.submittedAt.toMillis()) return malformed();
  if (value.status !== 'submitted'
    && (!timestamp(value.decidedAt) || value.decidedAt.toMillis() < value.submittedAt.toMillis()
      || value.updatedAt.toMillis() < value.decidedAt.toMillis() || !id(value.decidedBy, 128)
      || !rationale(value.decisionRationale) || typeof value.decisionRequestKey !== 'string'
      || !key.test(value.decisionRequestKey))) return malformed();
  return value as unknown as StoredAccountAppeal;
}
