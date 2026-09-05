import { httpsCallable } from 'firebase/functions';
import type { AccountModerationOperationStatus } from '../../../domain/models';
import { functionsClient } from '../../../lib/firebase/app';

export interface SuspendModerationTargetInput {
  reportId: string;
  requestId: string;
  reason: string;
}

export interface RestoreModerationTargetInput extends SuspendModerationTargetInput {
  suspensionActionId: string;
}

export interface RepublishSuspendedListingInput {
  listingId: string;
  suspensionActionId: string;
}

export interface AccountModerationOperationResult {
  actionId: string;
  status: AccountModerationOperationStatus;
  targetUid: string;
  hiddenListingCount: number;
}

export interface RepublishedListingResult {
  listingId: string;
  status: 'active';
  updatedAt: Date;
}

const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const actionPattern = /^[0-9a-f]{64}$/u;
const statuses = new Set<string>(['hiding', 'suspended', 'restored']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => keys.includes(field));
}

function identifier(value: unknown, maximum = 200): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= maximum
    && value === value.trim();
}

function validReason(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 1000
    && value === value.trim();
}

function assertAction(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !actionPattern.test(value)) {
    throw new Error('Account moderation action ID is invalid.');
  }
}

function assertRequestId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !uuidV4Pattern.test(value)) {
    throw new Error('Account moderation request ID is invalid.');
  }
}

export function createAccountModerationRequestId(): string {
  const value = globalThis.crypto.randomUUID();
  assertRequestId(value);
  return value;
}

function validateSuspendInput(value: unknown): asserts value is SuspendModerationTargetInput {
  if (!isRecord(value) || !exact(value, ['reportId', 'requestId', 'reason'])
    || !identifier(value.reportId) || !validReason(value.reason)) {
    throw new Error('Account suspension request is invalid.');
  }
  assertRequestId(value.requestId);
}

function validateRestoreInput(value: unknown): asserts value is RestoreModerationTargetInput {
  if (!isRecord(value)
    || !exact(value, ['reportId', 'suspensionActionId', 'requestId', 'reason'])
    || !identifier(value.reportId) || !validReason(value.reason)) {
    throw new Error('Account restoration request is invalid.');
  }
  assertAction(value.suspensionActionId);
  assertRequestId(value.requestId);
}

function validateRepublishInput(value: unknown): asserts value is RepublishSuspendedListingInput {
  if (!isRecord(value) || !exact(value, ['listingId', 'suspensionActionId'])
    || !identifier(value.listingId, 128)) {
    throw new Error('Held Listing republish request is invalid.');
  }
  assertAction(value.suspensionActionId);
}

function readOperationResult(
  value: unknown,
  requiredStatus?: AccountModerationOperationStatus,
): AccountModerationOperationResult {
  if (!isRecord(value)
    || !exact(value, ['actionId', 'status', 'targetUid', 'hiddenListingCount'])
    || typeof value.actionId !== 'string' || !actionPattern.test(value.actionId)
    || typeof value.status !== 'string' || !statuses.has(value.status)
    || (requiredStatus !== undefined && value.status !== requiredStatus)
    || !identifier(value.targetUid, 128)
    || !Number.isSafeInteger(value.hiddenListingCount)
    || (value.hiddenListingCount as number) < 0) {
    throw new Error('Received an invalid account moderation response.');
  }
  return value as unknown as AccountModerationOperationResult;
}

function readRepublishResult(value: unknown): RepublishedListingResult {
  if (!isRecord(value) || !exact(value, ['listingId', 'status', 'updatedAt'])
    || !identifier(value.listingId, 128) || value.status !== 'active'
    || !Number.isSafeInteger(value.updatedAt) || (value.updatedAt as number) < 0) {
    throw new Error('Received an invalid account moderation response.');
  }
  return {
    listingId: value.listingId,
    status: 'active',
    updatedAt: new Date(value.updatedAt as number),
  };
}

async function callService<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new Error('帳號管理服務目前無法使用，請稍後再試。');
  }
}

export async function suspendModerationTarget(
  input: SuspendModerationTargetInput,
): Promise<AccountModerationOperationResult> {
  validateSuspendInput(input);
  const request = { ...input };
  const callable = httpsCallable<typeof request, unknown>(
    functionsClient, 'suspendModerationTarget',
  );
  const result = await callService(() => callable(request));
  return readOperationResult(result.data);
}

export async function restoreModerationTarget(
  input: RestoreModerationTargetInput,
): Promise<AccountModerationOperationResult> {
  validateRestoreInput(input);
  const request = { ...input };
  const callable = httpsCallable<typeof request, unknown>(
    functionsClient, 'restoreModerationTarget',
  );
  const result = await callService(() => callable(request));
  return readOperationResult(result.data, 'restored');
}

export async function republishSuspendedListing(
  input: RepublishSuspendedListingInput,
): Promise<RepublishedListingResult> {
  validateRepublishInput(input);
  const request = { ...input };
  const callable = httpsCallable<typeof request, unknown>(
    functionsClient, 'republishSuspendedListing',
  );
  const result = await callService(() => callable(request));
  return readRepublishResult(result.data);
}
