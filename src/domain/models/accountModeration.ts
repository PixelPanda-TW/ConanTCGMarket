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

interface AccountModerationOperationSummaryBase {
  actionId: string;
  targetUid: string;
  sourceReportId: string;
  requestedBy: string;
  reason: string;
  confirmedViolationCount: number;
  hiddenListingCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface HidingAccountModerationOperationSummary
  extends AccountModerationOperationSummaryBase {
  status: 'hiding';
}

export interface SuspendedAccountModerationOperationSummary
  extends AccountModerationOperationSummaryBase {
  status: 'suspended';
  completedAt: Date;
}

export interface RestoredAccountModerationOperationSummary
  extends AccountModerationOperationSummaryBase {
  status: 'restored';
  completedAt: Date;
  restoredAt: Date;
  restoredBy: string;
  restorationReason: string;
}

export type AccountModerationOperationSummary =
  | HidingAccountModerationOperationSummary
  | SuspendedAccountModerationOperationSummary
  | RestoredAccountModerationOperationSummary;

interface AccountModerationAuditBase {
  eventId: string;
  targetUid: string;
  suspensionActionId: string;
  sourceReportId: string;
  actorUid: string;
  at: Date;
}

export interface SuspensionRequestedAuditEvent extends AccountModerationAuditBase {
  type: 'suspension_requested';
  reason: string;
  confirmedViolationCount: number;
}

export interface SuspensionCompletedAuditEvent extends AccountModerationAuditBase {
  type: 'suspension_completed';
  hiddenListingCount: number;
}

export interface RestoredAuditEvent extends AccountModerationAuditBase {
  type: 'restored';
  reason: string;
}

export interface ListingRepublishedAuditEvent extends AccountModerationAuditBase {
  type: 'listing_republished';
  listingId: string;
}

export type AccountModerationAuditEvent =
  | SuspensionRequestedAuditEvent
  | SuspensionCompletedAuditEvent
  | RestoredAuditEvent
  | ListingRepublishedAuditEvent;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, fields: readonly string[]) {
  const keys = Object.keys(value);
  if (keys.length !== fields.length || !fields.every((field) => keys.includes(field))) {
    throw new Error('Account moderation data requires exact fields.');
  }
}

function identifier(value: unknown, field: string, maximum = 200): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum
    || value !== value.trim()) {
    throw new Error(`Account moderation ${field} must be a trimmed identifier.`);
  }
}

function reason(value: unknown, field = 'reason'): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 1000
    || value !== value.trim()) {
    throw new Error(`Account moderation ${field} must contain 1 to 1000 trimmed characters.`);
  }
}

function count(value: unknown, field: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Account moderation ${field} must be a non-negative safe integer.`);
  }
}

function date(value: unknown, field: string): asserts value is Date {
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    throw new Error(`Account moderation ${field} must be a valid date.`);
  }
}

const operationBaseFields = [
  'actionId', 'status', 'targetUid', 'sourceReportId', 'requestedBy', 'reason',
  'confirmedViolationCount', 'hiddenListingCount', 'createdAt', 'updatedAt',
] as const;

export function validateAccountModerationOperationSummary(
  value: unknown,
): asserts value is AccountModerationOperationSummary {
  if (!isRecord(value)) throw new Error('Account moderation operation must be an object.');
  const status = value.status;
  if (!ACCOUNT_MODERATION_OPERATION_STATUSES.includes(
    status as AccountModerationOperationStatus,
  )) throw new Error('Account moderation operation has an unsupported status.');
  const extraFields = status === 'hiding'
    ? []
    : status === 'suspended'
      ? ['completedAt']
      : ['completedAt', 'restoredAt', 'restoredBy', 'restorationReason'];
  exact(value, [...operationBaseFields, ...extraFields]);
  identifier(value.actionId, 'actionId');
  identifier(value.targetUid, 'targetUid', 128);
  identifier(value.sourceReportId, 'sourceReportId');
  identifier(value.requestedBy, 'requestedBy', 128);
  reason(value.reason);
  count(value.confirmedViolationCount, 'confirmedViolationCount');
  count(value.hiddenListingCount, 'hiddenListingCount');
  date(value.createdAt, 'createdAt');
  date(value.updatedAt, 'updatedAt');
  if (value.updatedAt.valueOf() < value.createdAt.valueOf()) {
    throw new Error('Account moderation operation dates are out of order.');
  }
  if (status !== 'hiding') {
    const completedAt = value.completedAt;
    date(completedAt, 'completedAt');
    if (completedAt.valueOf() < value.createdAt.valueOf()
      || value.updatedAt.valueOf() < completedAt.valueOf()) {
      throw new Error('Account moderation operation dates are out of order.');
    }
  }
  if (status === 'restored') {
    const completedAt = value.completedAt;
    const restoredAt = value.restoredAt;
    date(completedAt, 'completedAt');
    date(restoredAt, 'restoredAt');
    identifier(value.restoredBy, 'restoredBy', 128);
    reason(value.restorationReason, 'restorationReason');
    if (restoredAt.valueOf() < completedAt.valueOf()
      || value.updatedAt.valueOf() < restoredAt.valueOf()) {
      throw new Error('Account moderation operation dates are out of order.');
    }
  }
}

const auditBaseFields = [
  'eventId', 'type', 'targetUid', 'suspensionActionId', 'sourceReportId',
  'actorUid', 'at',
] as const;

export function validateAccountModerationAuditEvent(
  value: unknown,
): asserts value is AccountModerationAuditEvent {
  if (!isRecord(value)) throw new Error('Account moderation audit event must be an object.');
  const type = value.type;
  if (!ACCOUNT_MODERATION_AUDIT_TYPES.includes(type as AccountModerationAuditType)) {
    throw new Error('Account moderation audit event has an unsupported type.');
  }
  const variantFields = type === 'suspension_requested'
    ? ['reason', 'confirmedViolationCount']
    : type === 'suspension_completed'
      ? ['hiddenListingCount']
      : type === 'restored'
        ? ['reason']
        : ['listingId'];
  exact(value, [...auditBaseFields, ...variantFields]);
  identifier(value.eventId, 'eventId');
  identifier(value.targetUid, 'targetUid', 128);
  identifier(value.suspensionActionId, 'suspensionActionId');
  identifier(value.sourceReportId, 'sourceReportId');
  identifier(value.actorUid, 'actorUid', 128);
  date(value.at, 'at');
  if (type === 'suspension_requested' || type === 'restored') reason(value.reason);
  if (type === 'suspension_requested') {
    count(value.confirmedViolationCount, 'confirmedViolationCount');
  }
  if (type === 'suspension_completed') count(value.hiddenListingCount, 'hiddenListingCount');
  if (type === 'listing_republished') identifier(value.listingId, 'listingId');
}
