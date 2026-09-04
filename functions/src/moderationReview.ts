import { Timestamp } from 'firebase-admin/firestore';

export const MODERATION_CASE_STATUSES = ['open', 'dismissed', 'confirmed'] as const;
export const MODERATION_DECISIONS = ['dismissed', 'confirmed'] as const;

export type ModerationCaseStatus = typeof MODERATION_CASE_STATUSES[number];
export type ModerationDecision = typeof MODERATION_DECISIONS[number];
export type ModerationReviewErrorCode =
  | 'unauthenticated'
  | 'permission-denied'
  | 'invalid-argument'
  | 'not-found'
  | 'failed-precondition'
  | 'aborted'
  | 'unavailable';

export class ModerationReviewError extends Error {
  constructor(public readonly code: ModerationReviewErrorCode, message: string) {
    super(message);
    this.name = 'ModerationReviewError';
  }
}

export interface OpenModerationCase {
  status: 'open';
  reportId: string;
  targetSellerId: string;
  openedAt: Timestamp;
}

export interface DismissedModerationCase extends Omit<OpenModerationCase, 'status'> {
  status: 'dismissed';
  rationale: string;
  decidedBy: string;
  decidedAt: Timestamp;
}

export interface ConfirmedModerationCase extends Omit<OpenModerationCase, 'status'> {
  status: 'confirmed';
  rationale: string;
  decidedBy: string;
  decidedAt: Timestamp;
  resultingConfirmedViolationCount: number;
}

export type ModerationCase =
  | OpenModerationCase
  | DismissedModerationCase
  | ConfirmedModerationCase;

export interface ModerationCaseCursorWire {
  openedAt: number;
  key: string;
}

export interface ListModerationCasesRequest {
  status: 'all' | ModerationCaseStatus;
  limit: number;
  cursor: ModerationCaseCursorWire | null;
}

export interface GetModerationCaseRequest { reportId: string }
export interface GetModerationEvidenceRequest { reportId: string; slot: 0 | 1 | 2 }
export interface DecideModerationCaseRequest {
  reportId: string;
  decision: ModerationDecision;
  rationale: string;
}

const idPattern = /^[A-Za-z0-9_-]{1,200}$/u;
const statuses = new Set<string>(['all', ...MODERATION_CASE_STATUSES]);
const decisions = new Set<string>(MODERATION_DECISIONS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => keys.includes(field));
}

function invalid(): never {
  throw new ModerationReviewError('invalid-argument', '請檢查審查資料。');
}

function malformed(): never {
  throw new ModerationReviewError('failed-precondition', '審查記錄無法使用。');
}

function readId(value: unknown, maximum = 200): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum
    || value !== value.trim()) return malformed();
  return value;
}

function readRequestId(value: unknown): string {
  if (typeof value !== 'string' || !idPattern.test(value)) return invalid();
  return value;
}

function readRationale(value: unknown, stored: boolean): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 1000
    || value !== value.trim()) return stored ? malformed() : invalid();
  return value;
}

export function parseListModerationCasesRequest(value: unknown): ListModerationCasesRequest {
  if (!isRecord(value) || Object.keys(value).some(
    (key) => !['status', 'limit', 'cursor'].includes(key),
  ) || typeof value.status !== 'string' || !statuses.has(value.status)) return invalid();
  const limit = value.limit ?? 20;
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 50) return invalid();
  const cursor = value.cursor ?? null;
  if (cursor !== null && (!isRecord(cursor) || !exact(cursor, ['openedAt', 'key'])
    || !Number.isSafeInteger(cursor.openedAt) || (cursor.openedAt as number) < 0
    || typeof cursor.key !== 'string' || !idPattern.test(cursor.key))) return invalid();
  return {
    status: value.status as ListModerationCasesRequest['status'],
    limit: limit as number,
    cursor: cursor as ModerationCaseCursorWire | null,
  };
}

export function parseGetModerationCaseRequest(value: unknown): GetModerationCaseRequest {
  if (!isRecord(value) || !exact(value, ['reportId'])) return invalid();
  return { reportId: readRequestId(value.reportId) };
}

export function parseGetModerationEvidenceRequest(value: unknown): GetModerationEvidenceRequest {
  if (!isRecord(value) || !exact(value, ['reportId', 'slot'])
    || !Number.isInteger(value.slot) || (value.slot as number) < 0 || (value.slot as number) > 2) {
    return invalid();
  }
  return { reportId: readRequestId(value.reportId), slot: value.slot as 0 | 1 | 2 };
}

export function parseDecideModerationCaseRequest(value: unknown): DecideModerationCaseRequest {
  if (!isRecord(value) || !exact(value, ['reportId', 'decision', 'rationale'])
    || typeof value.decision !== 'string' || !decisions.has(value.decision)) return invalid();
  return {
    reportId: readRequestId(value.reportId),
    decision: value.decision as ModerationDecision,
    rationale: readRationale(value.rationale, false),
  };
}

export function readModerationCase(value: unknown): ModerationCase {
  if (!isRecord(value)) return malformed();
  const common = ['status', 'reportId', 'targetSellerId', 'openedAt'];
  const expected = value.status === 'open' ? common
    : value.status === 'dismissed' ? [...common, 'rationale', 'decidedBy', 'decidedAt']
      : value.status === 'confirmed'
        ? [...common, 'rationale', 'decidedBy', 'decidedAt', 'resultingConfirmedViolationCount']
        : [];
  if (expected.length === 0 || !exact(value, expected) || !(value.openedAt instanceof Timestamp)) {
    return malformed();
  }
  const base = {
    reportId: readId(value.reportId),
    targetSellerId: readId(value.targetSellerId, 128),
    openedAt: value.openedAt,
  };
  if (value.status === 'open') return { status: 'open', ...base };
  if (!(value.decidedAt instanceof Timestamp)) return malformed();
  const decision = {
    ...base,
    rationale: readRationale(value.rationale, true),
    decidedBy: readId(value.decidedBy, 128),
    decidedAt: value.decidedAt,
  };
  if (value.status === 'dismissed') return { status: 'dismissed', ...decision };
  if (!Number.isInteger(value.resultingConfirmedViolationCount)
    || (value.resultingConfirmedViolationCount as number) < 1) return malformed();
  return {
    status: 'confirmed', ...decision,
    resultingConfirmedViolationCount: value.resultingConfirmedViolationCount as number,
  };
}
