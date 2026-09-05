export type AccountAccessStatus = 'active' | 'suspended';

interface AccountAccessBase {
  uid: string;
  confirmedViolationCount: number;
  updatedAt: Date;
}

export interface ActiveAccountAccess extends AccountAccessBase {
  status: 'active';
  suspensionReason?: never;
  suspendedAt?: never;
  suspendedBy?: never;
  suspensionActionId?: never;
}

export interface SuspendedAccountAccess extends AccountAccessBase {
  status: 'suspended';
  suspensionReason: string;
  suspendedAt: Date;
  suspendedBy: string;
  suspensionActionId: string;
}

export type AccountAccess = ActiveAccountAccess | SuspendedAccountAccess;

function validateIdentifier(value: unknown, fieldName: string) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128) {
    throw new Error(`Account access ${fieldName} must contain 1 to 128 characters.`);
  }
  if (value !== value.trim()) {
    throw new Error(`Account access ${fieldName} must be trimmed.`);
  }
}

function validateDate(value: unknown, fieldName: string) {
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    throw new Error(`Account access requires a valid ${fieldName} date.`);
  }
}

export function validateAccountAccess(value: unknown): asserts value is AccountAccess {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Account access must be an object.');
  }

  const access = value as Record<string, unknown>;
  validateIdentifier(access.uid, 'uid');

  if (access.status !== 'active' && access.status !== 'suspended') {
    throw new Error('Account access status must be active or suspended.');
  }
  if (!Number.isFinite(access.confirmedViolationCount)
    || !Number.isInteger(access.confirmedViolationCount)
    || (access.confirmedViolationCount as number) < 0) {
    throw new Error('Account access confirmedViolationCount must be a non-negative integer.');
  }
  validateDate(access.updatedAt, 'updatedAt');

  if (access.status === 'active') {
    if (access.suspensionReason !== undefined
      || access.suspendedAt !== undefined
      || access.suspendedBy !== undefined
      || access.suspensionActionId !== undefined) {
      throw new Error('Active account access records must omit suspension fields.');
    }
    if (Object.keys(access).length !== 4) {
      throw new Error('Active account access records require exact fields.');
    }
    return;
  }

  const suspendedFields = [
    'uid', 'status', 'confirmedViolationCount', 'updatedAt', 'suspensionReason',
    'suspendedAt', 'suspendedBy', 'suspensionActionId',
  ];
  if (Object.keys(access).length !== suspendedFields.length
    || !suspendedFields.every((field) => field in access)) {
    throw new Error('Suspended account access records require exact fields.');
  }

  if (typeof access.suspensionReason !== 'string'
    || access.suspensionReason.length < 1
    || access.suspensionReason.length > 1000) {
    throw new Error('Account access suspensionReason must contain 1 to 1000 characters.');
  }
  if (access.suspensionReason !== access.suspensionReason.trim()) {
    throw new Error('Account access suspensionReason must be trimmed.');
  }
  validateDate(access.suspendedAt, 'suspendedAt');
  validateIdentifier(access.suspendedBy, 'suspendedBy');
  validateIdentifier(access.suspensionActionId, 'suspensionActionId');
}
