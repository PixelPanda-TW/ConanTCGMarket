import { Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { readModerationCase, type ConfirmedModerationCase } from './moderationReview.js';
import { readModerationReport, type SubmittedModerationReport } from './reportTickets.js';
import { readStoredListing } from './listingLifecycle.js';

export const ACCOUNT_MODERATION_OPERATION_STATUSES = ['hiding', 'suspended', 'restored'] as const;
export const ACCOUNT_MODERATION_AUDIT_TYPES = [
  'suspension_requested',
  'suspension_completed',
  'restored',
  'listing_republished',
] as const;

export type AccountModerationOperationStatus =
  typeof ACCOUNT_MODERATION_OPERATION_STATUSES[number];
export type AccountModerationAuditType = typeof ACCOUNT_MODERATION_AUDIT_TYPES[number];

export type AccountModerationErrorCode =
  | 'unauthenticated'
  | 'permission-denied'
  | 'invalid-argument'
  | 'failed-precondition'
  | 'aborted'
  | 'unavailable';

export class AccountModerationError extends Error {
  constructor(public readonly code: AccountModerationErrorCode, message: string) {
    super(message);
    this.name = 'AccountModerationError';
  }
}

interface StoredOperationBase {
  actionId: string;
  targetUid: string;
  sourceReportId: string;
  requestedBy: string;
  reason: string;
  requestKey: string;
  confirmedViolationCount: number;
  hiddenListingCount: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface HidingAccountModerationOperation extends StoredOperationBase {
  status: 'hiding';
}

export interface SuspendedAccountModerationOperation extends StoredOperationBase {
  status: 'suspended';
  completedAt: Timestamp;
}

export interface RestoredAccountModerationOperation extends StoredOperationBase {
  status: 'restored';
  completedAt: Timestamp;
  restoredAt: Timestamp;
  restoredBy: string;
  restorationReason: string;
  restorationRequestKey: string;
}

export type AccountModerationOperation =
  | HidingAccountModerationOperation
  | SuspendedAccountModerationOperation
  | RestoredAccountModerationOperation;

interface StoredAuditBase {
  eventId: string;
  targetUid: string;
  suspensionActionId: string;
  sourceReportId: string;
  actorUid: string;
  at: Timestamp;
}

export type AccountModerationAuditEvent =
  | (StoredAuditBase & {
    type: 'suspension_requested'; reason: string; confirmedViolationCount: number;
  })
  | (StoredAuditBase & { type: 'suspension_completed'; hiddenListingCount: number })
  | (StoredAuditBase & { type: 'restored'; reason: string })
  | (StoredAuditBase & { type: 'listing_republished'; listingId: string });

export interface SuspendModerationTargetRequest {
  reportId: string;
  requestId: string;
  reason: string;
}

export interface AccountModerationCallableRequest {
  authUid: string | null;
  adminClaim: unknown;
  data: unknown;
}

export interface AccountSuspensionTransaction {
  getAccountAccess(uid: string): Promise<unknown | null>;
  getCase(id: string): Promise<unknown | null>;
  getReport(id: string): Promise<unknown | null>;
  getOperation(id: string): Promise<unknown | null>;
  createOperation(id: string, data: Record<string, unknown>): void;
  setAccountAccess(uid: string, data: Record<string, unknown>): void;
  createAudit(id: string, data: Record<string, unknown>): void;
}

export interface AccountSuspensionDependencies {
  now(): Date;
  runTransaction<T>(
    operation: (transaction: AccountSuspensionTransaction) => Promise<T>,
  ): Promise<T>;
}

export const ACCOUNT_MODERATION_HIDE_PAGE_SIZE = 100;
export const ACCOUNT_MODERATION_MAX_DRAIN_PAGES = 5;

export interface AccountModerationListingRecord {
  id: string;
  data: Record<string, unknown> | null;
}

export interface AccountModerationReconciliationTransaction {
  getOperation(id: string): Promise<unknown | null>;
  getAccountAccess(uid: string): Promise<unknown | null>;
  listActiveListings(
    targetUid: string,
    limit: number,
  ): Promise<AccountModerationListingRecord[]>;
  updateListing(id: string, patch: Record<string, unknown>): void;
  updateOperation(id: string, patch: Record<string, unknown>): void;
  createAudit(id: string, data: Record<string, unknown>): void;
}

export interface AccountModerationReconciliationDependencies {
  now(): Date;
  runTransaction<T>(
    operation: (transaction: AccountModerationReconciliationTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface AccountModerationOperationResult {
  actionId: string;
  status: AccountModerationOperationStatus;
  targetUid: string;
  hiddenListingCount: number;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const keyPattern = /^[0-9a-f]{64}$/u;

export function isAccountModerationRequestId(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => keys.includes(field));
}

function malformed(): never {
  throw new AccountModerationError('failed-precondition', '帳號管理記錄無法使用。');
}

function invalid(): never {
  throw new AccountModerationError('invalid-argument', '請檢查停權資料。');
}

function identifier(value: unknown, maximum = 200): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= maximum
    && value === value.trim();
}

function reason(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 1000
    && value === value.trim();
}

function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function timestamp(value: unknown): value is Timestamp {
  return value instanceof Timestamp && Number.isSafeInteger(value.toMillis())
    && value.toMillis() >= 0;
}

const operationBaseFields = [
  'actionId', 'status', 'targetUid', 'sourceReportId', 'requestedBy', 'reason',
  'requestKey', 'confirmedViolationCount', 'hiddenListingCount', 'createdAt', 'updatedAt',
] as const;

export function readAccountModerationOperation(value: unknown): AccountModerationOperation {
  if (!isRecord(value) || !ACCOUNT_MODERATION_OPERATION_STATUSES.includes(
    value.status as AccountModerationOperationStatus,
  )) return malformed();
  const extras = value.status === 'hiding'
    ? []
    : value.status === 'suspended'
      ? ['completedAt']
      : ['completedAt', 'restoredAt', 'restoredBy', 'restorationReason', 'restorationRequestKey'];
  if (!exact(value, [...operationBaseFields, ...extras])
    || !identifier(value.actionId)
    || !identifier(value.targetUid, 128)
    || !identifier(value.sourceReportId)
    || !identifier(value.requestedBy, 128)
    || !reason(value.reason)
    || typeof value.requestKey !== 'string' || !keyPattern.test(value.requestKey)
    || !count(value.confirmedViolationCount)
    || !count(value.hiddenListingCount)
    || !timestamp(value.createdAt)
    || !timestamp(value.updatedAt)
    || value.updatedAt.toMillis() < value.createdAt.toMillis()) return malformed();
  if (value.status === 'hiding') return value as unknown as HidingAccountModerationOperation;
  if (!timestamp(value.completedAt)
    || value.completedAt.toMillis() < value.createdAt.toMillis()
    || value.updatedAt.toMillis() < value.completedAt.toMillis()) return malformed();
  if (value.status === 'suspended') {
    return value as unknown as SuspendedAccountModerationOperation;
  }
  if (!timestamp(value.restoredAt)
    || !identifier(value.restoredBy, 128)
    || !reason(value.restorationReason)
    || typeof value.restorationRequestKey !== 'string'
    || !keyPattern.test(value.restorationRequestKey)
    || value.restoredAt.toMillis() < value.completedAt.toMillis()
    || value.updatedAt.toMillis() < value.restoredAt.toMillis()) return malformed();
  return value as unknown as RestoredAccountModerationOperation;
}

const auditBaseFields = [
  'eventId', 'type', 'targetUid', 'suspensionActionId', 'sourceReportId', 'actorUid', 'at',
] as const;

export function readAccountModerationAuditEvent(value: unknown): AccountModerationAuditEvent {
  if (!isRecord(value) || !ACCOUNT_MODERATION_AUDIT_TYPES.includes(
    value.type as AccountModerationAuditType,
  )) return malformed();
  const extras = value.type === 'suspension_requested'
    ? ['reason', 'confirmedViolationCount']
    : value.type === 'suspension_completed'
      ? ['hiddenListingCount']
      : value.type === 'restored'
        ? ['reason']
        : ['listingId'];
  if (!exact(value, [...auditBaseFields, ...extras])
    || !identifier(value.eventId)
    || !identifier(value.targetUid, 128)
    || !identifier(value.suspensionActionId)
    || !identifier(value.sourceReportId)
    || !identifier(value.actorUid, 128)
    || !timestamp(value.at)) return malformed();
  if ((value.type === 'suspension_requested' || value.type === 'restored')
    && !reason(value.reason)) return malformed();
  if (value.type === 'suspension_requested' && !count(value.confirmedViolationCount)) {
    return malformed();
  }
  if (value.type === 'suspension_completed' && !count(value.hiddenListingCount)) {
    return malformed();
  }
  if (value.type === 'listing_republished' && !identifier(value.listingId)) return malformed();
  return value as unknown as AccountModerationAuditEvent;
}

export function parseSuspendModerationTargetRequest(
  value: unknown,
): SuspendModerationTargetRequest {
  if (!isRecord(value) || !exact(value, ['reportId', 'requestId', 'reason'])
    || !identifier(value.reportId)
    || !isAccountModerationRequestId(value.requestId)
    || !reason(value.reason)) return invalid();
  return value as unknown as SuspendModerationTargetRequest;
}

interface ActiveStoredAccountAccess {
  status: 'active';
  confirmedViolationCount: number;
  updatedAt: Timestamp;
}

interface SuspendedStoredAccountAccess {
  status: 'suspended';
  confirmedViolationCount: number;
  suspensionReason: string;
  suspendedAt: Timestamp;
  suspendedBy: string;
  suspensionActionId: string;
  updatedAt: Timestamp;
}

type StoredAccountAccess = ActiveStoredAccountAccess | SuspendedStoredAccountAccess;

function readAccountAccess(value: unknown): StoredAccountAccess {
  if (!isRecord(value)) return malformed();
  if (value.status === 'active') {
    if (!exact(value, ['status', 'confirmedViolationCount', 'updatedAt'])
      || !count(value.confirmedViolationCount) || !timestamp(value.updatedAt)) return malformed();
    return value as unknown as ActiveStoredAccountAccess;
  }
  if (value.status === 'suspended') {
    if (!exact(value, [
      'status', 'confirmedViolationCount', 'suspensionReason', 'suspendedAt',
      'suspendedBy', 'suspensionActionId', 'updatedAt',
    ]) || !count(value.confirmedViolationCount)
      || !reason(value.suspensionReason)
      || !timestamp(value.suspendedAt)
      || !identifier(value.suspendedBy, 128)
      || !identifier(value.suspensionActionId)
      || !timestamp(value.updatedAt)) return malformed();
    return value as unknown as SuspendedStoredAccountAccess;
  }
  return malformed();
}

function requirePrincipal(request: AccountModerationCallableRequest): string {
  if (!identifier(request.authUid, 128)) {
    throw new AccountModerationError('unauthenticated', '請先使用 Google 登入。');
  }
  if (request.adminClaim !== true) {
    throw new AccountModerationError('permission-denied', '無權限執行帳號管理。');
  }
  return request.authUid;
}

function requireActiveAdminAccess(value: unknown | null): void {
  if (value === null) return;
  try {
    if (readAccountAccess(value).status === 'active') return;
  } catch {
    // Admin account state is intentionally mapped to the same authorization result.
  }
  throw new AccountModerationError('permission-denied', '無權限執行帳號管理。');
}

function readConfirmedPair(
  reportId: string,
  caseValue: unknown | null,
  reportValue: unknown | null,
): { moderationCase: ConfirmedModerationCase; report: SubmittedModerationReport } {
  try {
    const moderationCase = readModerationCase(caseValue);
    const report = readModerationReport(reportValue);
    if (moderationCase.status !== 'confirmed' || report.status !== 'submitted'
      || moderationCase.reportId !== reportId
      || moderationCase.targetSellerId !== report.targetSellerId
      || moderationCase.openedAt.toMillis() !== report.submittedAt.toMillis()) return malformed();
    return { moderationCase, report };
  } catch {
    return malformed();
  }
}

function suspensionActionId(adminUid: string, requestId: string): string {
  return createHash('sha256').update(`suspension:${adminUid}:${requestId}`, 'utf8').digest('hex');
}

function operationResult(operation: AccountModerationOperation): AccountModerationOperationResult {
  return {
    actionId: operation.actionId,
    status: operation.status,
    targetUid: operation.targetUid,
    hiddenListingCount: operation.hiddenListingCount,
  };
}

function assertCompatibleRetry(
  operation: AccountModerationOperation,
  input: SuspendModerationTargetRequest,
  adminUid: string,
  targetUid: string,
  actionId: string,
  targetAccess: StoredAccountAccess,
): void {
  if (operation.actionId !== actionId || operation.requestKey !== actionId
    || operation.requestedBy !== adminUid || operation.targetUid !== targetUid
    || operation.sourceReportId !== input.reportId || operation.reason !== input.reason) {
    return malformed();
  }
  if (operation.status === 'restored') {
    if (targetAccess.status !== 'active'
      || targetAccess.confirmedViolationCount < operation.confirmedViolationCount) return malformed();
    return;
  }
  if (targetAccess.status !== 'suspended'
    || targetAccess.suspensionActionId !== actionId
    || targetAccess.confirmedViolationCount < operation.confirmedViolationCount) return malformed();
}

export async function suspendModerationTarget(
  request: AccountModerationCallableRequest,
  dependencies: AccountSuspensionDependencies,
) {
  const input = parseSuspendModerationTargetRequest(request.data);
  const adminUid = requirePrincipal(request);
  const actionId = suspensionActionId(adminUid, input.requestId);
  const nowDate = dependencies.now();
  if (!(nowDate instanceof Date) || Number.isNaN(nowDate.valueOf())) {
    throw new AccountModerationError('unavailable', '目前無法停權帳號。');
  }
  const now = Timestamp.fromDate(nowDate);
  try {
    return await dependencies.runTransaction(async (transaction) => {
      const [adminAccessValue, caseValue, reportValue, operationValue] = await Promise.all([
        transaction.getAccountAccess(adminUid),
        transaction.getCase(input.reportId),
        transaction.getReport(input.reportId),
        transaction.getOperation(actionId),
      ]);
      requireActiveAdminAccess(adminAccessValue);
      const pair = readConfirmedPair(input.reportId, caseValue, reportValue);
      const targetUid = pair.report.targetSellerId;
      if (targetUid === adminUid) {
        throw new AccountModerationError('permission-denied', '管理員不能停權自己的帳號。');
      }
      const targetValue = await transaction.getAccountAccess(targetUid);
      const targetAccess: StoredAccountAccess = targetValue === null
        ? { status: 'active', confirmedViolationCount: 0, updatedAt: now }
        : readAccountAccess(targetValue);
      if (operationValue !== null) {
        const operation = readAccountModerationOperation(operationValue);
        assertCompatibleRetry(
          operation, input, adminUid, targetUid, actionId, targetAccess,
        );
        return operationResult(operation);
      }
      if (targetAccess.status !== 'active'
        || targetAccess.confirmedViolationCount < 2
        || pair.moderationCase.resultingConfirmedViolationCount
          > targetAccess.confirmedViolationCount) return malformed();

      const operation: HidingAccountModerationOperation = {
        actionId,
        status: 'hiding',
        targetUid,
        sourceReportId: input.reportId,
        requestedBy: adminUid,
        reason: input.reason,
        requestKey: actionId,
        confirmedViolationCount: targetAccess.confirmedViolationCount,
        hiddenListingCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      const requestedEventId = `${actionId}_requested`;
      transaction.createOperation(actionId, operation as unknown as Record<string, unknown>);
      transaction.setAccountAccess(targetUid, {
        status: 'suspended',
        confirmedViolationCount: targetAccess.confirmedViolationCount,
        suspensionReason: input.reason,
        suspendedAt: now,
        suspendedBy: adminUid,
        suspensionActionId: actionId,
        updatedAt: now,
      });
      transaction.createAudit(requestedEventId, {
        eventId: requestedEventId,
        type: 'suspension_requested',
        targetUid,
        suspensionActionId: actionId,
        sourceReportId: input.reportId,
        actorUid: adminUid,
        reason: input.reason,
        confirmedViolationCount: targetAccess.confirmedViolationCount,
        at: now,
      });
      return operationResult(operation);
    });
  } catch (error) {
    if (error instanceof AccountModerationError) throw error;
    throw new AccountModerationError('unavailable', '目前無法停權帳號。');
  }
}

function assertReconciliationAccount(
  operation: AccountModerationOperation,
  value: unknown | null,
): StoredAccountAccess {
  if (value === null) return malformed();
  const access = readAccountAccess(value);
  if (operation.status === 'restored') {
    if (access.status !== 'active'
      || access.confirmedViolationCount < operation.confirmedViolationCount) return malformed();
    return access;
  }
  if (access.status !== 'suspended'
    || access.suspensionActionId !== operation.actionId
    || access.suspensionReason !== operation.reason
    || access.suspendedBy !== operation.requestedBy
    || access.suspendedAt.toMillis() !== operation.createdAt.toMillis()
    || access.confirmedViolationCount < operation.confirmedViolationCount) return malformed();
  return access;
}

function readActiveListingPage(
  records: AccountModerationListingRecord[],
  targetUid: string,
) {
  if (records.length > ACCOUNT_MODERATION_HIDE_PAGE_SIZE) return malformed();
  let previousId: string | null = null;
  return records.map((record) => {
    if (!identifier(record.id, 128)
      || (previousId !== null && previousId.localeCompare(record.id) >= 0)) return malformed();
    previousId = record.id;
    const listing = readStoredListing(record.data);
    if (!listing || listing.sellerId !== targetUid || listing.status !== 'active'
      || listing.remainingQuantity < 1) return malformed();
    return { id: record.id, listing };
  });
}

export async function reconcileAccountModerationOperation(
  actionId: string,
  dependencies: AccountModerationReconciliationDependencies,
): Promise<AccountModerationOperationResult> {
  if (!keyPattern.test(actionId)) return malformed();
  const nowDate = dependencies.now();
  if (!(nowDate instanceof Date) || Number.isNaN(nowDate.valueOf())) {
    throw new AccountModerationError('unavailable', '目前無法完成商品隱藏。');
  }
  const now = Timestamp.fromDate(nowDate);
  try {
    return await dependencies.runTransaction(async (transaction) => {
      const operationValue = await transaction.getOperation(actionId);
      const operation = readAccountModerationOperation(operationValue);
      if (operation.actionId !== actionId || operation.requestKey !== actionId) return malformed();
      const accessValue = await transaction.getAccountAccess(operation.targetUid);
      assertReconciliationAccount(operation, accessValue);
      if (operation.status !== 'hiding') return operationResult(operation);

      const page = readActiveListingPage(
        await transaction.listActiveListings(
          operation.targetUid,
          ACCOUNT_MODERATION_HIDE_PAGE_SIZE,
        ),
        operation.targetUid,
      );
      if (page.length === 0) {
        const completed: SuspendedAccountModerationOperation = {
          ...operation,
          status: 'suspended',
          completedAt: now,
          updatedAt: now,
        };
        const eventId = `${actionId}_completed`;
        transaction.updateOperation(actionId, {
          status: 'suspended', completedAt: now, updatedAt: now,
        });
        transaction.createAudit(eventId, {
          eventId,
          type: 'suspension_completed',
          targetUid: operation.targetUid,
          suspensionActionId: actionId,
          sourceReportId: operation.sourceReportId,
          actorUid: operation.requestedBy,
          hiddenListingCount: operation.hiddenListingCount,
          at: now,
        });
        return operationResult(completed);
      }

      const hiddenListingCount = operation.hiddenListingCount + page.length;
      if (!Number.isSafeInteger(hiddenListingCount)) return malformed();
      for (const record of page) {
        transaction.updateListing(record.id, {
          status: 'suspended',
          suspensionActionId: actionId,
          suspendedAt: operation.createdAt.toDate(),
          updatedAt: nowDate,
        });
      }
      transaction.updateOperation(actionId, { hiddenListingCount, updatedAt: now });
      return operationResult({ ...operation, hiddenListingCount, updatedAt: now });
    });
  } catch (error) {
    if (error instanceof AccountModerationError) throw error;
    throw new AccountModerationError('unavailable', '目前無法完成商品隱藏。');
  }
}

export async function drainAccountModerationOperation(
  actionId: string,
  reconcile: (actionId: string) => Promise<AccountModerationOperationResult>,
): Promise<AccountModerationOperationResult> {
  let result: AccountModerationOperationResult | null = null;
  for (let page = 0; page < ACCOUNT_MODERATION_MAX_DRAIN_PAGES; page += 1) {
    result = await reconcile(actionId);
    if (result.actionId !== actionId || result.status !== 'hiding') return result;
  }
  if (!result) {
    throw new AccountModerationError('unavailable', '目前無法完成商品隱藏。');
  }
  return result;
}
