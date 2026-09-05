import { Timestamp } from 'firebase-admin/firestore';

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
