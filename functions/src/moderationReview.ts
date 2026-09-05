import { Timestamp } from 'firebase-admin/firestore';
import {
  readModerationReport,
  type ReportListingSnapshot,
  type SubmittedModerationReport,
} from './reportTickets.js';
import {
  readAccountModerationAuditEvent,
  readAccountModerationOperation,
  type AccountModerationAuditEvent,
  type AccountModerationOperation,
} from './accountModeration.js';

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

export interface ModerationAdminCallableRequest {
  authUid: string | null;
  adminClaim: unknown;
  data: unknown;
}

export interface ModerationCaseListRecord {
  id: string;
  data: unknown;
}

export interface ModerationCaseListDependencies {
  getAccountAccess(uid: string): Promise<unknown | null>;
  listCases(input: ListModerationCasesRequest): Promise<ModerationCaseListRecord[]>;
  getReports(ids: string[]): Promise<Array<{ id: string; data: unknown | null }>>;
}

export interface ModerationCaseDetailDependencies {
  getAccountAccess(uid: string): Promise<unknown | null>;
  getCase(id: string): Promise<unknown | null>;
  getReport(id: string): Promise<unknown | null>;
  getAccountModerationOperation(id: string): Promise<unknown | null>;
  listAccountModerationAudit(
    targetUid: string,
    limit: number,
  ): Promise<ModerationCaseListRecord[]>;
}

export interface ModerationEvidenceDependencies extends ModerationCaseDetailDependencies {
  getEvidenceMetadata(path: string): Promise<unknown | null>;
  downloadEvidence(path: string, generation: string): Promise<Buffer>;
}

export interface ModerationDecisionTransaction {
  getCase(id: string): Promise<unknown | null>;
  getReport(id: string): Promise<unknown | null>;
  getAccountAccess(uid: string): Promise<unknown | null>;
  setCase(id: string, data: Record<string, unknown>): void;
  setAccountAccess(uid: string, data: Record<string, unknown>): void;
}

export interface ModerationDecisionDependencies {
  now(): Date;
  getAccountAccess(uid: string): Promise<unknown | null>;
  runTransaction<T>(
    operation: (transaction: ModerationDecisionTransaction) => Promise<T>,
  ): Promise<T>;
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

function isTimestampLike(value: unknown): boolean {
  return value instanceof Timestamp
    || (value instanceof Date && !Number.isNaN(value.valueOf()));
}

function isCanonicalActiveAccess(value: unknown): boolean {
  if (!isRecord(value) || !exact(value, ['status', 'confirmedViolationCount', 'updatedAt'])) {
    return false;
  }
  return value.status === 'active'
    && Number.isSafeInteger(value.confirmedViolationCount)
    && (value.confirmedViolationCount as number) >= 0
    && isTimestampLike(value.updatedAt);
}

type AccountSummary = {
  status: 'active';
  confirmedViolationCount: number;
  suspensionEligible: boolean;
} | {
  status: 'suspended';
  confirmedViolationCount: number;
  suspensionEligible: boolean;
  suspensionReason: string;
  suspendedAt: number;
  suspendedBy: string;
  suspensionActionId: string;
};

function accountSummary(value: unknown | null): AccountSummary {
  if (value === null) {
    return { status: 'active', confirmedViolationCount: 0, suspensionEligible: false };
  }
  if (!isRecord(value)) return malformed();
  const activeFields = ['status', 'confirmedViolationCount', 'updatedAt'];
  const suspendedFields = [
    ...activeFields, 'suspensionReason', 'suspendedAt', 'suspendedBy', 'suspensionActionId',
  ];
  const expected = value.status === 'active' ? activeFields
    : value.status === 'suspended' ? suspendedFields : [];
  if (expected.length === 0 || !exact(value, expected)
    || !Number.isSafeInteger(value.confirmedViolationCount)
    || (value.confirmedViolationCount as number) < 0 || !isTimestampLike(value.updatedAt)) {
    return malformed();
  }
  if (value.status === 'suspended'
    && (typeof value.suspensionReason !== 'string' || value.suspensionReason.length < 1
      || value.suspensionReason.length > 1000
      || value.suspensionReason !== value.suspensionReason.trim()
      || typeof value.suspendedBy !== 'string' || value.suspendedBy.length < 1
      || value.suspendedBy.length > 128 || value.suspendedBy !== value.suspendedBy.trim()
      || typeof value.suspensionActionId !== 'string'
      || value.suspensionActionId.length < 1 || value.suspensionActionId.length > 200
      || value.suspensionActionId !== value.suspensionActionId.trim()
      || !isTimestampLike(value.suspendedAt))) return malformed();
  const count = value.confirmedViolationCount as number;
  if (value.status === 'active') return {
    status: 'active',
    confirmedViolationCount: count,
    suspensionEligible: count >= 2,
  };
  const suspendedAt = value.suspendedAt instanceof Timestamp
    ? value.suspendedAt.toMillis() : (value.suspendedAt as Date).valueOf();
  return {
    status: 'suspended', confirmedViolationCount: count, suspensionEligible: count >= 2,
    suspensionReason: value.suspensionReason as string,
    suspendedAt,
    suspendedBy: value.suspendedBy as string,
    suspensionActionId: value.suspensionActionId as string,
  };
}

export async function requireActiveAdmin(
  request: Pick<ModerationAdminCallableRequest, 'authUid' | 'adminClaim'>,
  getAccountAccess: (uid: string) => Promise<unknown | null>,
): Promise<string> {
  if (typeof request.authUid !== 'string' || request.authUid.length < 1
    || request.authUid.length > 128 || request.authUid !== request.authUid.trim()) {
    throw new ModerationReviewError('unauthenticated', '請先使用 Google 登入。');
  }
  if (request.adminClaim !== true) {
    throw new ModerationReviewError('permission-denied', '無權限使用審查工具。');
  }
  const access = await getAccountAccess(request.authUid);
  if (access !== null && !isCanonicalActiveAccess(access)) {
    throw new ModerationReviewError('permission-denied', '無權限使用審查工具。');
  }
  return request.authUid;
}

function readSubmittedPair(
  caseRecord: ModerationCaseListRecord,
  reportRecord: { id: string; data: unknown | null },
): { moderationCase: ModerationCase; report: SubmittedModerationReport } {
  try {
    if (caseRecord.id !== reportRecord.id || caseRecord.data === null || reportRecord.data === null) {
      return malformed();
    }
    const moderationCase = readModerationCase(caseRecord.data);
    const report = readModerationReport(reportRecord.data);
    if (moderationCase.reportId !== caseRecord.id || report.status !== 'submitted'
      || report.targetSellerId !== moderationCase.targetSellerId
      || report.submittedAt.toMillis() !== moderationCase.openedAt.toMillis()) {
      return malformed();
    }
    return { moderationCase, report };
  } catch {
    return malformed();
  }
}

function listingSnapshotWire(snapshot: ReportListingSnapshot) {
  return {
    listingId: snapshot.listingId,
    cardType: snapshot.cardType,
    cardName: snapshot.cardName,
    cardId: snapshot.cardId,
    rarity: snapshot.rarity,
    listingPrice: snapshot.listingPrice,
    createdAt: snapshot.createdAt.toMillis(),
  };
}

function summaryWire(moderationCase: ModerationCase, report: SubmittedModerationReport) {
  const common = {
    reportId: moderationCase.reportId,
    status: moderationCase.status,
    category: report.category,
    targetSellerId: moderationCase.targetSellerId,
    listingSnapshot: listingSnapshotWire(report.listingSnapshot),
    openedAt: moderationCase.openedAt.toMillis(),
  };
  if (moderationCase.status === 'open') return common;
  if (moderationCase.status === 'dismissed') {
    return { ...common, decidedAt: moderationCase.decidedAt.toMillis() };
  }
  return {
    ...common,
    decidedAt: moderationCase.decidedAt.toMillis(),
    resultingConfirmedViolationCount: moderationCase.resultingConfirmedViolationCount,
  };
}

function assertCaseOrder(records: readonly ModerationCaseListRecord[], limit: number): void {
  if (records.length > limit) return malformed();
  let previous: { openedAt: number; id: string } | null = null;
  for (const record of records) {
    const moderationCase = readModerationCase(record.data);
    if (record.id !== moderationCase.reportId) return malformed();
    const current = { openedAt: moderationCase.openedAt.toMillis(), id: record.id };
    if (previous && (previous.openedAt < current.openedAt
      || (previous.openedAt === current.openedAt
        && previous.id.localeCompare(current.id) <= 0))) return malformed();
    previous = current;
  }
}

export async function listModerationCases(
  request: ModerationAdminCallableRequest,
  dependencies: ModerationCaseListDependencies,
) {
  const input = parseListModerationCasesRequest(request.data);
  try {
    await requireActiveAdmin(request, dependencies.getAccountAccess);
    const caseRecords = await dependencies.listCases(input);
    assertCaseOrder(caseRecords, input.limit);
    if (caseRecords.length === 0) return { cases: [], nextCursor: null };
    const reportRecords = await dependencies.getReports(caseRecords.map(({ id }) => id));
    if (reportRecords.length !== caseRecords.length) return malformed();
    const cases = caseRecords.map((caseRecord, index) => {
      const pair = readSubmittedPair(caseRecord, reportRecords[index]);
      return summaryWire(pair.moderationCase, pair.report);
    });
    const last = caseRecords.at(-1);
    const lastCase = last ? readModerationCase(last.data) : null;
    return {
      cases,
      nextCursor: caseRecords.length === input.limit && last && lastCase
        ? { openedAt: lastCase.openedAt.toMillis(), key: last.id }
        : null,
    };
  } catch (error) {
    if (error instanceof ModerationReviewError) throw error;
    throw new ModerationReviewError('unavailable', '目前無法載入審查案件。');
  }
}

function evidenceSummaries(reportId: string, report: SubmittedModerationReport) {
  const prefix = `reportEvidence/${report.reporterId}/${reportId}/`;
  let previousSlot = -1;
  return report.evidence.map((item) => {
    if (!item.path.startsWith(prefix)) return malformed();
    const slotText = item.path.slice(prefix.length);
    if (!/^[0-2]$/u.test(slotText)) return malformed();
    const slot = Number(slotText);
    if (slot <= previousSlot) return malformed();
    previousSlot = slot;
    return { slot: slot as 0 | 1 | 2, contentType: item.contentType, size: item.size };
  });
}

function detailWire(
  moderationCase: ModerationCase,
  report: SubmittedModerationReport,
  account: AccountSummary,
  accountModeration: {
    operation: ReturnType<typeof operationSummaryWire> | null;
    history: ReturnType<typeof auditEventWire>[];
  },
) {
  const common = {
    reportId: moderationCase.reportId,
    status: moderationCase.status,
    category: report.category,
    description: report.description,
    reporterId: report.reporterId,
    targetSellerId: report.targetSellerId,
    listingSnapshot: listingSnapshotWire(report.listingSnapshot),
    submittedAt: report.submittedAt.toMillis(),
    openedAt: moderationCase.openedAt.toMillis(),
    evidence: evidenceSummaries(moderationCase.reportId, report),
    account,
    accountModeration,
  };
  if (moderationCase.status === 'open') return common;
  const decided = {
    ...common,
    rationale: moderationCase.rationale,
    decidedBy: moderationCase.decidedBy,
    decidedAt: moderationCase.decidedAt.toMillis(),
  };
  if (moderationCase.status === 'dismissed') return decided;
  if (moderationCase.resultingConfirmedViolationCount > account.confirmedViolationCount) {
    return malformed();
  }
  return {
    ...decided,
    resultingConfirmedViolationCount: moderationCase.resultingConfirmedViolationCount,
  };
}

function operationSummaryWire(operation: AccountModerationOperation) {
  const common = {
    actionId: operation.actionId,
    status: operation.status,
    targetUid: operation.targetUid,
    sourceReportId: operation.sourceReportId,
    requestedBy: operation.requestedBy,
    reason: operation.reason,
    confirmedViolationCount: operation.confirmedViolationCount,
    hiddenListingCount: operation.hiddenListingCount,
    createdAt: operation.createdAt.toMillis(),
    updatedAt: operation.updatedAt.toMillis(),
  };
  if (operation.status === 'hiding') return common;
  if (operation.status === 'suspended') {
    return { ...common, completedAt: operation.completedAt.toMillis() };
  }
  return {
    ...common,
    completedAt: operation.completedAt.toMillis(),
    restoredAt: operation.restoredAt.toMillis(),
    restoredBy: operation.restoredBy,
    restorationReason: operation.restorationReason,
  };
}

function auditEventWire(event: AccountModerationAuditEvent) {
  const common = {
    eventId: event.eventId,
    type: event.type,
    targetUid: event.targetUid,
    suspensionActionId: event.suspensionActionId,
    sourceReportId: event.sourceReportId,
    actorUid: event.actorUid,
    at: event.at.toMillis(),
  };
  if (event.type === 'suspension_requested') {
    return {
      ...common, reason: event.reason, confirmedViolationCount: event.confirmedViolationCount,
    };
  }
  if (event.type === 'suspension_completed') {
    return { ...common, hiddenListingCount: event.hiddenListingCount };
  }
  if (event.type === 'restored') return { ...common, reason: event.reason };
  return { ...common, listingId: event.listingId };
}

async function readAccountModerationHistory(
  targetUid: string,
  account: AccountSummary,
  dependencies: ModerationCaseDetailDependencies,
) {
  const records = await dependencies.listAccountModerationAudit(targetUid, 20);
  if (!Array.isArray(records) || records.length > 20) return malformed();
  const history: AccountModerationAuditEvent[] = [];
  for (const record of records) {
    let event: AccountModerationAuditEvent;
    try {
      event = readAccountModerationAuditEvent(record.data);
    } catch {
      return malformed();
    }
    if (record.id !== event.eventId || event.targetUid !== targetUid) return malformed();
    const previous = history.at(-1);
    if (previous && (previous.at.toMillis() < event.at.toMillis()
      || (previous.at.toMillis() === event.at.toMillis()
        && previous.eventId.localeCompare(event.eventId) <= 0))) return malformed();
    history.push(event);
  }
  const actionId = account.status === 'suspended'
    ? account.suspensionActionId : history[0]?.suspensionActionId;
  if (!actionId) return { operation: null, history: [] };
  const rawOperation = await dependencies.getAccountModerationOperation(actionId);
  let operation: AccountModerationOperation;
  try {
    operation = readAccountModerationOperation(rawOperation);
  } catch {
    return malformed();
  }
  if (operation.actionId !== actionId || operation.targetUid !== targetUid) return malformed();
  if (account.status === 'suspended') {
    if (operation.status === 'restored'
      || !history.some((event) => event.suspensionActionId === actionId)) return malformed();
  } else if (operation.status !== 'restored') return malformed();
  return { operation: operationSummaryWire(operation), history: history.map(auditEventWire) };
}

export async function getModerationCase(
  request: ModerationAdminCallableRequest,
  dependencies: ModerationCaseDetailDependencies,
) {
  const input = parseGetModerationCaseRequest(request.data);
  try {
    await requireActiveAdmin(request, dependencies.getAccountAccess);
    const [caseData, reportData] = await Promise.all([
      dependencies.getCase(input.reportId),
      dependencies.getReport(input.reportId),
    ]);
    const pair = readSubmittedPair(
      { id: input.reportId, data: caseData },
      { id: input.reportId, data: reportData },
    );
    const targetAccess = await dependencies.getAccountAccess(pair.report.targetSellerId);
    const account = accountSummary(targetAccess);
    const accountModeration = await readAccountModerationHistory(
      pair.report.targetSellerId, account, dependencies,
    );
    return detailWire(pair.moderationCase, pair.report, account, accountModeration);
  } catch (error) {
    if (error instanceof ModerationReviewError) throw error;
    throw new ModerationReviewError('unavailable', '目前無法載入審查案件。');
  }
}

function readCurrentEvidenceMetadata(value: unknown): {
  contentType: string;
  size: number;
  generation: string;
} {
  if (!isRecord(value) || typeof value.contentType !== 'string'
    || (typeof value.size !== 'string' && typeof value.size !== 'number')
    || typeof value.generation !== 'string' || value.generation.length < 1) {
    return malformed();
  }
  const size = typeof value.size === 'string' && /^\d+$/u.test(value.size)
    ? Number(value.size) : value.size;
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 1
    || size > 5 * 1024 * 1024) return malformed();
  return { contentType: value.contentType, size, generation: value.generation };
}

export async function getModerationEvidence(
  request: ModerationAdminCallableRequest,
  dependencies: ModerationEvidenceDependencies,
) {
  const input = parseGetModerationEvidenceRequest(request.data);
  try {
    await requireActiveAdmin(request, dependencies.getAccountAccess);
    const [caseData, reportData] = await Promise.all([
      dependencies.getCase(input.reportId),
      dependencies.getReport(input.reportId),
    ]);
    const pair = readSubmittedPair(
      { id: input.reportId, data: caseData },
      { id: input.reportId, data: reportData },
    );
    evidenceSummaries(input.reportId, pair.report);
    const path = `reportEvidence/${pair.report.reporterId}/${input.reportId}/${input.slot}`;
    const recorded = pair.report.evidence.find((item) => item.path === path);
    if (!recorded) return malformed();
    const current = readCurrentEvidenceMetadata(
      await dependencies.getEvidenceMetadata(path),
    );
    if (current.contentType !== recorded.contentType || current.size !== recorded.size
      || current.generation !== recorded.generation) return malformed();
    const bytes = await dependencies.downloadEvidence(path, recorded.generation);
    if (!Buffer.isBuffer(bytes) || bytes.length !== recorded.size) return malformed();
    return {
      contentType: recorded.contentType,
      size: recorded.size,
      dataBase64: bytes.toString('base64'),
    };
  } catch (error) {
    if (error instanceof ModerationReviewError) throw error;
    throw new ModerationReviewError('unavailable', '目前無法載入證據圖片。');
  }
}

function decisionResult(
  reportId: string,
  status: ModerationDecision,
  count: number,
) {
  return {
    reportId,
    status,
    resultingConfirmedViolationCount: count,
    suspensionEligible: count >= 2,
  };
}

function assertIdenticalDecision(
  moderationCase: DismissedModerationCase | ConfirmedModerationCase,
  input: DecideModerationCaseRequest,
  adminUid: string,
): void {
  if (moderationCase.status !== input.decision
    || moderationCase.rationale !== input.rationale
    || moderationCase.decidedBy !== adminUid) {
    throw new ModerationReviewError('failed-precondition', '這筆案件已完成審查。');
  }
}

export async function decideModerationCase(
  request: ModerationAdminCallableRequest,
  dependencies: ModerationDecisionDependencies,
) {
  const input = parseDecideModerationCaseRequest(request.data);
  try {
    const adminUid = await requireActiveAdmin(request, dependencies.getAccountAccess);
    const nowDate = dependencies.now();
    if (Number.isNaN(nowDate.valueOf())) {
      throw new ModerationReviewError('unavailable', '目前無法完成審查。');
    }
    const decidedAt = Timestamp.fromDate(nowDate);
    return await dependencies.runTransaction(async (transaction) => {
      const [caseData, reportData] = await Promise.all([
        transaction.getCase(input.reportId),
        transaction.getReport(input.reportId),
      ]);
      const pair = readSubmittedPair(
        { id: input.reportId, data: caseData },
        { id: input.reportId, data: reportData },
      );
      const targetAccess = await transaction.getAccountAccess(pair.report.targetSellerId);
      const targetSummary = accountSummary(targetAccess);

      if (pair.moderationCase.status !== 'open') {
        assertIdenticalDecision(pair.moderationCase, input, adminUid);
        if (pair.moderationCase.status === 'confirmed'
          && pair.moderationCase.resultingConfirmedViolationCount
            > targetSummary.confirmedViolationCount) return malformed();
        return decisionResult(
          input.reportId,
          pair.moderationCase.status,
          targetSummary.confirmedViolationCount,
        );
      }

      const terminalBase = {
        reportId: pair.moderationCase.reportId,
        targetSellerId: pair.moderationCase.targetSellerId,
        openedAt: pair.moderationCase.openedAt,
        rationale: input.rationale,
        decidedBy: adminUid,
        decidedAt,
      };
      if (input.decision === 'dismissed') {
        transaction.setCase(input.reportId, { status: 'dismissed', ...terminalBase });
        return decisionResult(
          input.reportId, 'dismissed', targetSummary.confirmedViolationCount,
        );
      }

      if (targetSummary.confirmedViolationCount >= Number.MAX_SAFE_INTEGER) return malformed();
      const count = targetSummary.confirmedViolationCount + 1;
      transaction.setCase(input.reportId, {
        status: 'confirmed', ...terminalBase, resultingConfirmedViolationCount: count,
      });
      transaction.setAccountAccess(pair.report.targetSellerId, targetAccess === null
        ? { status: 'active', confirmedViolationCount: count, updatedAt: decidedAt }
        : { ...targetAccess, confirmedViolationCount: count, updatedAt: decidedAt });
      return decisionResult(input.reportId, 'confirmed', count);
    });
  } catch (error) {
    if (error instanceof ModerationReviewError) throw error;
    throw new ModerationReviewError('unavailable', '目前無法完成審查。');
  }
}
