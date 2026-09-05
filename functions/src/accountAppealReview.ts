import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import {
  applyAccountRestoration,
  readAccountModerationOperation,
} from './accountModeration.js';
import {
  AccountAppealError,
  parseAccountAppealDecisionRequest,
  readStoredAccountAppeal,
} from './accountAppeals.js';

export interface AccountAppealAdminRequest {
  authUid: string | null;
  adminClaim: unknown;
  data: unknown;
}
export interface AccountAppealDecisionTransaction {
  getAccountAccess(uid: string): Promise<unknown | null>;
  getAppeal(id: string): Promise<unknown | null>;
  getOperation(id: string): Promise<unknown | null>;
  updateAppeal(id: string, patch: Record<string, unknown>): void;
  setAccountAccess(uid: string, data: Record<string, unknown>): void;
  updateOperation(id: string, patch: Record<string, unknown>): void;
  createAccountModerationAudit(id: string, data: Record<string, unknown>): void;
  createAppealAudit(id: string, data: Record<string, unknown>): void;
}
export interface AccountAppealDecisionDependencies {
  now(): Date;
  runTransaction<T>(operation: (transaction: AccountAppealDecisionTransaction) => Promise<T>): Promise<T>;
}
export interface AccountAppealReadDependencies {
  getAccountAccess(uid: string): Promise<unknown | null>;
  getAppeal(id: string): Promise<unknown | null>;
}
export interface AccountAppealListDependencies {
  getAccountAccess(uid: string): Promise<unknown | null>;
  listAppeals(input: {
    status: 'submitted' | 'dismissed' | 'approved'; limit: number;
    cursor: { submittedAt: number; key: string } | null;
  }): Promise<Array<{ id: string; data: unknown }>>;
}
export interface AccountAppealEvidenceDependencies extends AccountAppealReadDependencies {
  getEvidenceMetadata(path: string): Promise<unknown | null>;
  downloadEvidence(path: string, generation: string): Promise<Buffer>;
}

function hash(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => keys.includes(field));
}
function requireAdmin(request: AccountAppealAdminRequest, access: unknown | null): string {
  if (typeof request.authUid !== 'string' || request.authUid.length < 1) {
    throw new AccountAppealError('unauthenticated', '請先登入。');
  }
  if (request.adminClaim !== true) {
    throw new AccountAppealError('permission-denied', '無法執行申訴審核。');
  }
  if (access !== null && (!record(access)
    || !exact(access, ['status', 'confirmedViolationCount', 'updatedAt'])
    || access.status !== 'active' || !Number.isSafeInteger(access.confirmedViolationCount)
    || (access.confirmedViolationCount as number) < 0 || !(access.updatedAt instanceof Timestamp))) {
    throw new AccountAppealError('permission-denied', '無法執行申訴審核。');
  }
  return request.authUid;
}
function result(appealId: string, status: 'dismissed' | 'approved', at: Timestamp) {
  return { appealId, status, decidedAt: at.toMillis() };
}

function parseIdRequest(value: unknown): string {
  if (!record(value) || !exact(value, ['appealId'])
    || typeof value.appealId !== 'string' || value.appealId.length < 1
    || value.appealId.length > 200 || value.appealId !== value.appealId.trim()) {
    throw new AccountAppealError('invalid-argument', '請檢查申訴編號。');
  }
  return value.appealId;
}
function appealDetail(appeal: ReturnType<typeof readStoredAccountAppeal>) {
  const common = {
    appealId: appeal.appealId, status: appeal.status, targetUid: appeal.targetUid,
    suspensionActionId: appeal.suspensionActionId, statement: appeal.statement,
    evidence: appeal.evidence.map(({ slot, contentType, size }) => ({ slot, contentType, size })),
    submittedAt: appeal.submittedAt.toMillis(), updatedAt: appeal.updatedAt.toMillis(),
  };
  return appeal.status === 'submitted' ? common : {
    ...common, decidedAt: appeal.decidedAt.toMillis(), decidedBy: appeal.decidedBy,
    decisionRationale: appeal.decisionRationale,
  };
}
function appealSummary(appeal: ReturnType<typeof readStoredAccountAppeal>) {
  const { statement: _statement, evidence: _evidence, ...detail } = appealDetail(appeal);
  return { ...detail, evidenceCount: appeal.evidence.length };
}

export async function listAccountAppeals(
  request: AccountAppealAdminRequest,
  dependencies: AccountAppealListDependencies,
) {
  if (!record(request.data) || !exact(request.data, ['status', 'limit', 'cursor'])
    || !['submitted', 'dismissed', 'approved'].includes(String(request.data.status))
    || !Number.isInteger(request.data.limit) || (request.data.limit as number) < 1
    || (request.data.limit as number) > 50) {
    throw new AccountAppealError('invalid-argument', '請檢查申訴清單條件。');
  }
  let cursor: { submittedAt: number; key: string } | null = null;
  if (request.data.cursor !== null) {
    if (!record(request.data.cursor) || !exact(request.data.cursor, ['submittedAt', 'key'])
      || !Number.isSafeInteger(request.data.cursor.submittedAt)
      || (request.data.cursor.submittedAt as number) < 0
      || typeof request.data.cursor.key !== 'string' || request.data.cursor.key.length < 1) {
      throw new AccountAppealError('invalid-argument', '請檢查申訴清單游標。');
    }
    cursor = request.data.cursor as { submittedAt: number; key: string };
  }
  const input = request.data as {
    status: 'submitted' | 'dismissed' | 'approved'; limit: number;
  };
  try {
    requireAdmin(request, await dependencies.getAccountAccess(request.authUid ?? ''));
    const rows = await dependencies.listAppeals({
      status: input.status,
      limit: input.limit, cursor,
    });
    if (!Array.isArray(rows) || rows.length > input.limit) {
      throw new AccountAppealError('failed-precondition', '申訴清單無法使用。');
    }
    const appeals = rows.map((row) => {
      const appeal = readStoredAccountAppeal(row.data);
      if (row.id !== appeal.appealId || appeal.status !== input.status) {
        throw new AccountAppealError('failed-precondition', '申訴清單無法使用。');
      }
      return appealSummary(appeal);
    });
    for (let index = 1; index < appeals.length; index += 1) {
      const previous = appeals[index - 1]; const current = appeals[index];
      if (previous.submittedAt < current.submittedAt
        || (previous.submittedAt === current.submittedAt
          && previous.appealId.localeCompare(current.appealId) <= 0)) {
        throw new AccountAppealError('failed-precondition', '申訴清單順序無法使用。');
      }
    }
    const last = appeals.at(-1);
    return {
      appeals,
      nextCursor: appeals.length === input.limit && last
        ? { submittedAt: last.submittedAt, key: last.appealId } : null,
    };
  } catch (error) {
    if (error instanceof AccountAppealError) throw error;
    throw new AccountAppealError('unavailable', '目前無法載入申訴清單。');
  }
}

export async function getAccountAppeal(
  request: AccountAppealAdminRequest,
  dependencies: AccountAppealReadDependencies,
) {
  const appealId = parseIdRequest(request.data);
  try {
    const adminUid = requireAdmin(request, await dependencies.getAccountAccess(request.authUid ?? ''));
    const appeal = readStoredAccountAppeal(await dependencies.getAppeal(appealId));
    if (appeal.appealId !== appealId || appeal.targetUid === adminUid) {
      throw new AccountAppealError('permission-denied', '無法查看此申訴。');
    }
    return appealDetail(appeal);
  } catch (error) {
    if (error instanceof AccountAppealError) throw error;
    throw new AccountAppealError('unavailable', '目前無法載入申訴。');
  }
}

export async function getAccountAppealEvidence(
  request: AccountAppealAdminRequest,
  dependencies: AccountAppealEvidenceDependencies,
) {
  if (!record(request.data) || !exact(request.data, ['appealId', 'slot'])
    || typeof request.data.appealId !== 'string' || request.data.appealId.length < 1
    || !Number.isInteger(request.data.slot) || (request.data.slot as number) < 0
    || (request.data.slot as number) > 2) {
    throw new AccountAppealError('invalid-argument', '請檢查申訴證據。');
  }
  const input = request.data as { appealId: string; slot: number };
  try {
    const adminUid = requireAdmin(request, await dependencies.getAccountAccess(request.authUid ?? ''));
    const appeal = readStoredAccountAppeal(await dependencies.getAppeal(input.appealId));
    if (appeal.appealId !== input.appealId || appeal.targetUid === adminUid) {
      throw new AccountAppealError('permission-denied', '無法查看此申訴證據。');
    }
    const recorded = appeal.evidence.find((item) => item.slot === input.slot);
    if (!recorded) throw new AccountAppealError('failed-precondition', '申訴證據無法使用。');
    const path = `account-appeal-evidence/${appeal.targetUid}/${appeal.suspensionActionId}/${appeal.draftId}/${recorded.slot}`;
    const metadata = await dependencies.getEvidenceMetadata(path);
    if (!record(metadata) || !exact(metadata, ['generation', 'contentType', 'size'])) {
      throw new AccountAppealError('failed-precondition', '申訴證據無法使用。');
    }
    const size = typeof metadata.size === 'string' && /^\d+$/u.test(metadata.size)
      ? Number(metadata.size) : metadata.size;
    if (metadata.generation !== recorded.generation
      || metadata.contentType !== recorded.contentType || size !== recorded.size) {
      throw new AccountAppealError('failed-precondition', '申訴證據無法使用。');
    }
    const bytes = await dependencies.downloadEvidence(path, recorded.generation);
    if (!Buffer.isBuffer(bytes) || bytes.length !== recorded.size) {
      throw new AccountAppealError('failed-precondition', '申訴證據無法使用。');
    }
    return { contentType: recorded.contentType, size: recorded.size, dataBase64: bytes.toString('base64') };
  } catch (error) {
    if (error instanceof AccountAppealError) throw error;
    throw new AccountAppealError('unavailable', '目前無法載入申訴證據。');
  }
}

export async function decideAccountAppeal(
  request: AccountAppealAdminRequest,
  dependencies: AccountAppealDecisionDependencies,
) {
  const input = parseAccountAppealDecisionRequest(request.data);
  const nowDate = dependencies.now();
  if (!(nowDate instanceof Date) || Number.isNaN(nowDate.valueOf())) {
    throw new AccountAppealError('unavailable', '目前無法完成申訴審核。');
  }
  const decidedAt = Timestamp.fromDate(nowDate);
  try {
    return await dependencies.runTransaction(async (transaction) => {
      const adminUid = requireAdmin(
        request,
        await transaction.getAccountAccess(request.authUid ?? ''),
      );
      const appeal = readStoredAccountAppeal(await transaction.getAppeal(input.appealId));
      if (appeal.appealId !== input.appealId || appeal.targetUid === adminUid) {
        throw new AccountAppealError('permission-denied', '無法執行申訴審核。');
      }
      const decisionKey = hash(`${adminUid}\0${input.requestId}\0${input.appealId}`);
      const [targetAccess, rawOperation] = await Promise.all([
        transaction.getAccountAccess(appeal.targetUid),
        transaction.getOperation(appeal.suspensionActionId),
      ]);
      const operation = readAccountModerationOperation(rawOperation);
      if (operation.actionId !== appeal.suspensionActionId
        || operation.targetUid !== appeal.targetUid) {
        throw new AccountAppealError('failed-precondition', '申訴狀態已變更。');
      }
      if (appeal.status !== 'submitted') {
        if (appeal.status !== input.decision || appeal.decidedBy !== adminUid
          || appeal.decisionRationale !== input.rationale
          || appeal.decisionRequestKey !== decisionKey) {
          throw new AccountAppealError('failed-precondition', '申訴已完成審核。');
        }
        return result(appeal.appealId, appeal.status, appeal.decidedAt);
      }
      if (operation.status !== 'suspended') {
        throw new AccountAppealError('failed-precondition', '申訴狀態已變更。');
      }
      if (input.decision === 'approved') {
        applyAccountRestoration({
          setAccountAccess: transaction.setAccountAccess,
          updateOperation: transaction.updateOperation,
          createAudit: transaction.createAccountModerationAudit,
        }, {
          operation, targetAccessValue: targetAccess, actorUid: adminUid,
          reason: input.rationale, restorationRequestKey: decisionKey, at: decidedAt,
        });
      } else if (!record(targetAccess) || targetAccess.status !== 'suspended'
        || targetAccess.suspensionActionId !== appeal.suspensionActionId) {
        throw new AccountAppealError('failed-precondition', '申訴狀態已變更。');
      }
      transaction.updateAppeal(appeal.appealId, {
        status: input.decision, decidedAt, decidedBy: adminUid,
        decisionRationale: input.rationale, decisionRequestKey: decisionKey,
        updatedAt: decidedAt,
      });
      const eventId = `${appeal.appealId}_${input.decision}`;
      transaction.createAppealAudit(eventId, {
        eventId, type: input.decision === 'approved' ? 'appeal_approved' : 'appeal_dismissed',
        appealId: appeal.appealId, targetUid: appeal.targetUid,
        suspensionActionId: appeal.suspensionActionId, actorUid: adminUid,
        rationale: input.rationale, at: decidedAt,
      });
      return result(appeal.appealId, input.decision, decidedAt);
    });
  } catch (error) {
    if (error instanceof AccountAppealError) throw error;
    throw new AccountAppealError('unavailable', '目前無法完成申訴審核。');
  }
}
