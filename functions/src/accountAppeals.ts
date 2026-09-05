import { Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { readAccountModerationOperation } from './accountModeration.js';

export type AccountAppealErrorCode = 'unauthenticated' | 'permission-denied'
  | 'invalid-argument' | 'failed-precondition' | 'already-exists' | 'resource-exhausted'
  | 'aborted' | 'unavailable';
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

export interface AccountAppealCallableRequest { authUid: string | null; data: unknown }
export interface AccountAppealSubmissionTransaction {
  getAccountAccess(uid: string): Promise<unknown | null>;
  getOperation(id: string): Promise<unknown | null>;
  getAppeal(id: string): Promise<unknown | null>;
  getRequestPointer(id: string): Promise<unknown | null>;
  getDailyLimit(id: string): Promise<unknown | null>;
  createAppeal(id: string, data: Record<string, unknown>): void;
  createRequestPointer(id: string, data: Record<string, unknown>): void;
  setDailyLimit(id: string, data: Record<string, unknown>): void;
  createAudit(id: string, data: Record<string, unknown>): void;
}
export interface AccountAppealSubmissionDependencies {
  now(): Date;
  getEvidenceMetadata(path: string): Promise<unknown | null>;
  runTransaction<T>(
    operation: (transaction: AccountAppealSubmissionTransaction) => Promise<T>,
  ): Promise<T>;
}
export interface OwnAccountAppealDependencies {
  getAccountAccess(uid: string): Promise<unknown | null>;
  getAppeal(id: string): Promise<unknown | null>;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
function readSuspendedAccess(value: unknown, uid: string, actionId: string): void {
  if (!record(value)) throw new AccountAppealError('permission-denied', '此帳號目前無法申訴。');
  try {
    exact(value, ['status', 'confirmedViolationCount', 'suspensionReason', 'suspendedAt',
      'suspendedBy', 'suspensionActionId', 'updatedAt']);
  } catch {
    throw new AccountAppealError('permission-denied', '此帳號目前無法申訴。');
  }
  if (value.status !== 'suspended' || value.suspensionActionId !== actionId
    || !Number.isSafeInteger(value.confirmedViolationCount)
    || (value.confirmedViolationCount as number) < 0 || !rationale(value.suspensionReason)
    || !timestamp(value.suspendedAt) || !id(value.suspendedBy, 128)
    || !timestamp(value.updatedAt) || !id(uid, 128)) {
    throw new AccountAppealError('permission-denied', '此帳號目前無法申訴。');
  }
}
function readPointer(value: unknown): {
  appealId: string; targetUid: string; requestIdHash: string;
} | null {
  if (value === null) return null;
  if (!record(value)) return malformed();
  try { exact(value, ['appealId', 'targetUid', 'requestIdHash', 'createdAt']); } catch {
    return malformed();
  }
  if (!id(value.appealId) || !id(value.targetUid, 128)
    || typeof value.requestIdHash !== 'string' || !key.test(value.requestIdHash)
    || !timestamp(value.createdAt)) return malformed();
  return value as { appealId: string; targetUid: string; requestIdHash: string };
}
function readLimit(value: unknown, uid: string, utcDate: string): { count: number; createdAt: Timestamp } {
  if (value === null) return { count: 0, createdAt: Timestamp.fromMillis(0) };
  if (!record(value)) return malformed();
  try { exact(value, ['targetUid', 'utcDate', 'count', 'createdAt', 'updatedAt']); } catch {
    return malformed();
  }
  if (value.targetUid !== uid || value.utcDate !== utcDate || !Number.isSafeInteger(value.count)
    || (value.count as number) < 0 || (value.count as number) > 5
    || !timestamp(value.createdAt) || !timestamp(value.updatedAt)) return malformed();
  return { count: value.count as number, createdAt: value.createdAt };
}
function ensureMetadata(expected: AccountAppealEvidenceInput, actual: unknown): void {
  if (!record(actual)) throw new AccountAppealError('failed-precondition', '申訴證據無法使用。');
  try { exact(actual, ['generation', 'contentType', 'size']); } catch {
    throw new AccountAppealError('failed-precondition', '申訴證據無法使用。');
  }
  if (actual.generation !== expected.generation || actual.contentType !== expected.contentType
    || actual.size !== expected.size) {
    throw new AccountAppealError('failed-precondition', '申訴證據無法使用。');
  }
}

export async function submitAccountAppeal(
  request: AccountAppealCallableRequest,
  dependencies: AccountAppealSubmissionDependencies,
): Promise<StoredAccountAppeal> {
  if (!id(request.authUid, 128)) {
    throw new AccountAppealError('unauthenticated', '請先登入。');
  }
  const uid = request.authUid;
  const input = parseAccountAppealSubmissionRequest(request.data);
  for (const item of input.evidence) {
    const path = `account-appeal-evidence/${uid}/${input.suspensionActionId}/${input.draftId}/${item.slot}`;
    ensureMetadata(item, await dependencies.getEvidenceMetadata(path));
  }
  const nowDate = dependencies.now();
  if (Number.isNaN(nowDate.valueOf())) {
    throw new AccountAppealError('unavailable', '目前無法提交申訴。');
  }
  const now = Timestamp.fromDate(nowDate);
  const requestIdHash = sha256(input.requestId);
  const requestKey = sha256(`${uid}\0${input.requestId}`);
  const appealId = sha256(`appeal\0${input.suspensionActionId}`);
  try {
    return await dependencies.runTransaction(async (transaction) => {
      readSuspendedAccess(
        await transaction.getAccountAccess(uid), uid, input.suspensionActionId,
      );
      const operation = readAccountModerationOperation(
        await transaction.getOperation(input.suspensionActionId),
      );
      if (operation.status !== 'suspended' || operation.targetUid !== uid
        || operation.actionId !== input.suspensionActionId) {
        throw new AccountAppealError('failed-precondition', '此停權目前無法申訴。');
      }
      const pointer = readPointer(await transaction.getRequestPointer(requestKey));
      if (pointer) {
        if (pointer.appealId !== appealId || pointer.targetUid !== uid
          || pointer.requestIdHash !== requestIdHash) return malformed();
        const existing = readStoredAccountAppeal(await transaction.getAppeal(appealId));
        if (existing.targetUid !== uid || existing.suspensionActionId !== input.suspensionActionId
          || existing.requestKey !== requestKey || existing.statement !== input.statement
          || JSON.stringify(existing.evidence) !== JSON.stringify(input.evidence)) return malformed();
        return existing;
      }
      if (await transaction.getAppeal(appealId) !== null) {
        throw new AccountAppealError('already-exists', '此停權已有申訴。');
      }
      const utcDate = nowDate.toISOString().slice(0, 10);
      const limitKey = `${uid}_${utcDate}`;
      const limit = readLimit(await transaction.getDailyLimit(limitKey), uid, utcDate);
      if (limit.count >= 5) {
        throw new AccountAppealError('resource-exhausted', '今日申訴嘗試已達上限。');
      }
      const appeal: StoredAccountAppeal = {
        appealId, status: 'submitted', targetUid: uid,
        suspensionActionId: input.suspensionActionId, statement: input.statement,
        evidence: input.evidence, requestKey, submittedAt: now, updatedAt: now,
      };
      transaction.createAppeal(appealId, { ...appeal });
      transaction.createRequestPointer(requestKey, {
        appealId, targetUid: uid, requestIdHash, createdAt: now,
      });
      transaction.setDailyLimit(limitKey, {
        targetUid: uid, utcDate, count: limit.count + 1,
        createdAt: limit.count === 0 ? now : limit.createdAt, updatedAt: now,
      });
      transaction.createAudit(sha256(`${appealId}\0submitted`), {
        eventId: sha256(`${appealId}\0submitted`), type: 'appeal_submitted',
        appealId, targetUid: uid, suspensionActionId: input.suspensionActionId, at: now,
      });
      return appeal;
    });
  } catch (error) {
    if (error instanceof AccountAppealError) throw error;
    throw new AccountAppealError('unavailable', '目前無法提交申訴。');
  }
}

export async function getOwnAccountAppeal(
  request: AccountAppealCallableRequest,
  dependencies: OwnAccountAppealDependencies,
): Promise<StoredAccountAppeal | null> {
  if (!id(request.authUid, 128)) {
    throw new AccountAppealError('unauthenticated', '請先登入。');
  }
  if (!record(request.data)) return invalid();
  exact(request.data, ['suspensionActionId']);
  if (!id(request.data.suspensionActionId)) return invalid();
  const uid = request.authUid;
  const actionId = request.data.suspensionActionId;
  readSuspendedAccess(await dependencies.getAccountAccess(uid), uid, actionId);
  const value = await dependencies.getAppeal(sha256(`appeal\0${actionId}`));
  if (value === null) return null;
  const appeal = readStoredAccountAppeal(value);
  if (appeal.targetUid !== uid || appeal.suspensionActionId !== actionId) return malformed();
  return appeal;
}
