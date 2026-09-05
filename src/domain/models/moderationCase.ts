import type { ModerationReportCategory } from './moderationReport';
import {
  validateAccountModerationAuditEvent,
  validateAccountModerationOperationSummary,
  type AccountModerationAuditEvent,
  type AccountModerationOperationSummary,
} from './accountModeration';

export const MODERATION_CASE_STATUSES = ['open', 'dismissed', 'confirmed'] as const;
export const MODERATION_CASE_FILTERS = ['all', ...MODERATION_CASE_STATUSES] as const;
export const MODERATION_DECISIONS = ['dismissed', 'confirmed'] as const;

export type ModerationCaseStatus = typeof MODERATION_CASE_STATUSES[number];
export type ModerationCaseFilter = typeof MODERATION_CASE_FILTERS[number];
export type ModerationDecision = typeof MODERATION_DECISIONS[number];

export interface ModerationListingSnapshot {
  listingId: string;
  cardType: 'character' | 'event' | 'case' | 'partner';
  cardName: string;
  cardId: string;
  rarity: string;
  listingPrice: number;
  createdAt: Date;
}

interface ModerationCaseSummaryBase {
  reportId: string;
  category: ModerationReportCategory;
  targetSellerId: string;
  listingSnapshot: ModerationListingSnapshot;
  openedAt: Date;
}

export type ModerationCaseSummary =
  | (ModerationCaseSummaryBase & { status: 'open' })
  | (ModerationCaseSummaryBase & { status: 'dismissed'; decidedAt: Date })
  | (ModerationCaseSummaryBase & {
    status: 'confirmed';
    decidedAt: Date;
    resultingConfirmedViolationCount: number;
  });

export interface ModerationCaseCursor {
  openedAt: Date;
  key: string;
}

export interface ModerationCasePage {
  cases: ModerationCaseSummary[];
  nextCursor: ModerationCaseCursor | null;
}

export interface ModerationEvidenceSummary {
  slot: 0 | 1 | 2;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  size: number;
}

interface ModerationAccountSummaryBase {
  confirmedViolationCount: number;
  suspensionEligible: boolean;
}

export type ModerationAccountSummary =
  | (ModerationAccountSummaryBase & { status: 'active' })
  | (ModerationAccountSummaryBase & {
    status: 'suspended';
    suspensionReason: string;
    suspendedAt: Date;
    suspendedBy: string;
    suspensionActionId: string;
  });

export interface ModerationAccountHistory {
  operation: AccountModerationOperationSummary | null;
  history: AccountModerationAuditEvent[];
}

interface ModerationCaseDetailBase {
  reportId: string;
  category: ModerationReportCategory;
  description: string;
  reporterId: string;
  targetSellerId: string;
  listingSnapshot: ModerationListingSnapshot;
  submittedAt: Date;
  openedAt: Date;
  evidence: ModerationEvidenceSummary[];
  account: ModerationAccountSummary;
  accountModeration: ModerationAccountHistory;
}

export type ModerationCaseDetail =
  | (ModerationCaseDetailBase & { status: 'open' })
  | (ModerationCaseDetailBase & {
    status: 'dismissed';
    rationale: string;
    decidedBy: string;
    decidedAt: Date;
  })
  | (ModerationCaseDetailBase & {
    status: 'confirmed';
    rationale: string;
    decidedBy: string;
    decidedAt: Date;
    resultingConfirmedViolationCount: number;
  });

export interface ModerationDecisionResult {
  reportId: string;
  status: ModerationDecision;
  resultingConfirmedViolationCount: number;
  suspensionEligible: boolean;
}

const categories = new Set<string>([
  'suspected_counterfeit', 'listing_mismatch', 'fraud_or_harassment',
  'prohibited_content', 'other',
]);
const evidenceTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const idPattern = /^[A-Za-z0-9_-]{1,200}$/u;
const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => keys.includes(field));
}

function fail(message: string): never {
  throw new Error(message);
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.valueOf());
}

function validId(value: unknown, maximum = 200): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= maximum
    && value === value.trim();
}

function validateListingSnapshot(value: unknown): asserts value is ModerationListingSnapshot {
  if (!isRecord(value) || !exact(value, [
    'listingId', 'cardType', 'cardName', 'cardId', 'rarity', 'listingPrice', 'createdAt',
  ]) || !validId(value.listingId)
    || !['character', 'event', 'case', 'partner'].includes(value.cardType as string)
    || !validId(value.cardName) || !validId(value.cardId, 100) || !validId(value.rarity, 100)
    || typeof value.listingPrice !== 'number' || !Number.isFinite(value.listingPrice)
    || value.listingPrice <= 0 || value.listingPrice > 10_000_000
    || !validDate(value.createdAt)) {
    fail('Moderation Listing snapshot is invalid.');
  }
}

function summaryFields(status: unknown): string[] {
  const common = ['reportId', 'status', 'category', 'targetSellerId', 'listingSnapshot', 'openedAt'];
  if (status === 'open') return common;
  if (status === 'dismissed') return [...common, 'decidedAt'];
  if (status === 'confirmed') {
    return [...common, 'decidedAt', 'resultingConfirmedViolationCount'];
  }
  return [];
}

function validateSummary(value: unknown): asserts value is ModerationCaseSummary {
  if (!isRecord(value) || !exact(value, summaryFields(value.status))
    || !validId(value.reportId) || !categories.has(value.category as string)
    || !validId(value.targetSellerId, 128) || !validDate(value.openedAt)) {
    fail('Moderation case summary requires exact fields.');
  }
  validateListingSnapshot(value.listingSnapshot);
  if (value.status !== 'open' && !validDate(value.decidedAt)) {
    fail('Moderation case decision time is invalid.');
  }
  if (value.status === 'confirmed'
    && (!Number.isInteger(value.resultingConfirmedViolationCount)
      || (value.resultingConfirmedViolationCount as number) < 1)) {
    fail('Moderation confirmed count is invalid.');
  }
}

export function validateModerationCasePage(value: unknown, requestedLimit: number): void {
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 50
    || !isRecord(value) || !exact(value, ['cases', 'nextCursor'])
    || !Array.isArray(value.cases) || value.cases.length > requestedLimit) {
    fail('Moderation case page requires exact fields.');
  }
  value.cases.forEach(validateSummary);
  for (let index = 1; index < value.cases.length; index += 1) {
    const previous = value.cases[index - 1] as ModerationCaseSummary;
    const current = value.cases[index] as ModerationCaseSummary;
    if (previous.openedAt.valueOf() < current.openedAt.valueOf()
      || (previous.openedAt.valueOf() === current.openedAt.valueOf()
        && previous.reportId.localeCompare(current.reportId) <= 0)) {
      fail('Moderation case page is not deterministically ordered.');
    }
  }
  if (value.nextCursor === null) return;
  if (!isRecord(value.nextCursor) || !exact(value.nextCursor, ['openedAt', 'key'])
    || !validDate(value.nextCursor.openedAt) || !idPattern.test(String(value.nextCursor.key))) {
    fail('Moderation case cursor is invalid.');
  }
  const last = value.cases.at(-1) as ModerationCaseSummary | undefined;
  if (value.cases.length !== requestedLimit || !last
    || value.nextCursor.openedAt.valueOf() !== last.openedAt.valueOf()
    || value.nextCursor.key !== last.reportId) {
    fail('Moderation case cursor does not match the page.');
  }
}

function validateEvidence(value: unknown, previousSlot: number): number {
  if (!isRecord(value) || !exact(value, ['slot', 'contentType', 'size'])
    || !Number.isInteger(value.slot) || (value.slot as number) < 0 || (value.slot as number) > 2
    || (value.slot as number) <= previousSlot || !evidenceTypes.has(value.contentType as string)
    || !Number.isSafeInteger(value.size) || (value.size as number) < 1
    || (value.size as number) > MAX_EVIDENCE_BYTES) {
    fail('Moderation evidence summary is invalid.');
  }
  return value.slot as number;
}

function validateAccount(value: unknown): asserts value is ModerationAccountSummary {
  if (!isRecord(value) || (value.status !== 'active' && value.status !== 'suspended')) {
    fail('Moderation account summary is invalid.');
  }
  const fields = value.status === 'active'
    ? ['status', 'confirmedViolationCount', 'suspensionEligible']
    : [
      'status', 'confirmedViolationCount', 'suspensionEligible', 'suspensionReason',
      'suspendedAt', 'suspendedBy', 'suspensionActionId',
    ];
  if (!exact(value, fields)
    || !Number.isInteger(value.confirmedViolationCount)
    || (value.confirmedViolationCount as number) < 0
    || typeof value.suspensionEligible !== 'boolean'
    || value.suspensionEligible !== ((value.confirmedViolationCount as number) >= 2)) {
    fail('Moderation account summary is invalid.');
  }
  if (value.status === 'suspended'
    && (typeof value.suspensionReason !== 'string' || value.suspensionReason.length < 1
      || value.suspensionReason.length > 1000
      || value.suspensionReason !== value.suspensionReason.trim()
      || !validDate(value.suspendedAt) || !validId(value.suspendedBy, 128)
      || !validId(value.suspensionActionId))) {
    fail('Moderation account summary is invalid.');
  }
}

function validateAccountModeration(
  value: unknown,
  account: ModerationAccountSummary,
  targetSellerId: string,
): void {
  if (!isRecord(value) || !exact(value, ['operation', 'history'])
    || !Array.isArray(value.history) || value.history.length > 20) {
    fail('Moderation account history is invalid.');
  }
  if (value.operation !== null) validateAccountModerationOperationSummary(value.operation);
  let previous: AccountModerationAuditEvent | null = null;
  for (const item of value.history) {
    validateAccountModerationAuditEvent(item);
    if (item.targetUid !== targetSellerId
      || (previous && (previous.at.valueOf() < item.at.valueOf()
        || (previous.at.valueOf() === item.at.valueOf()
          && previous.eventId.localeCompare(item.eventId) <= 0)))) {
      fail('Moderation account history is invalid.');
    }
    previous = item;
  }
  const operation = value.operation as AccountModerationOperationSummary | null;
  if (operation !== null && operation.targetUid !== targetSellerId) {
    fail('Moderation account history is invalid.');
  }
  if (account.status === 'suspended') {
    if (operation === null || operation.actionId !== account.suspensionActionId
      || operation.status === 'restored'
      || !value.history.some((item) => (
        (item as AccountModerationAuditEvent).suspensionActionId === account.suspensionActionId
      ))) fail('Moderation account history is invalid.');
  } else if (operation !== null && operation.status !== 'restored') {
    fail('Moderation account history is invalid.');
  }
}

function detailFields(status: unknown): string[] {
  const common = [
    'reportId', 'status', 'category', 'description', 'reporterId', 'targetSellerId',
    'listingSnapshot', 'submittedAt', 'openedAt', 'evidence', 'account', 'accountModeration',
  ];
  if (status === 'open') return common;
  if (status === 'dismissed') return [...common, 'rationale', 'decidedBy', 'decidedAt'];
  if (status === 'confirmed') {
    return [...common, 'rationale', 'decidedBy', 'decidedAt', 'resultingConfirmedViolationCount'];
  }
  return [];
}

export function validateModerationCaseDetail(value: unknown): void {
  if (!isRecord(value) || !exact(value, detailFields(value.status))
    || !validId(value.reportId) || !categories.has(value.category as string)
    || typeof value.description !== 'string' || value.description.length < 1
    || value.description.length > 100 || value.description !== value.description.trim()
    || !validId(value.reporterId, 128) || !validId(value.targetSellerId, 128)
    || !validDate(value.submittedAt) || !validDate(value.openedAt)
    || !Array.isArray(value.evidence) || value.evidence.length > 3) {
    fail('Moderation case detail requires exact fields.');
  }
  validateListingSnapshot(value.listingSnapshot);
  let previousSlot = -1;
  for (const item of value.evidence) previousSlot = validateEvidence(item, previousSlot);
  validateAccount(value.account);
  validateAccountModeration(value.accountModeration, value.account, value.targetSellerId as string);
  if (value.status !== 'open') {
    if (typeof value.rationale !== 'string' || value.rationale.length < 1
      || value.rationale.length > 1000 || value.rationale !== value.rationale.trim()
      || !validId(value.decidedBy, 128) || !validDate(value.decidedAt)) {
      fail('Moderation decision detail is invalid.');
    }
  }
  if (value.status === 'confirmed'
    && (!Number.isInteger(value.resultingConfirmedViolationCount)
      || (value.resultingConfirmedViolationCount as number) < 1
      || (value.resultingConfirmedViolationCount as number)
        > value.account.confirmedViolationCount)) {
    fail('Moderation confirmed count is invalid.');
  }
}

export function validateModerationDecisionResult(value: unknown): void {
  if (!isRecord(value) || !exact(value, [
    'reportId', 'status', 'resultingConfirmedViolationCount', 'suspensionEligible',
  ]) || !validId(value.reportId)
    || (value.status !== 'dismissed' && value.status !== 'confirmed')
    || !Number.isInteger(value.resultingConfirmedViolationCount)
    || (value.resultingConfirmedViolationCount as number) < 0
    || typeof value.suspensionEligible !== 'boolean'
    || value.suspensionEligible !== ((value.resultingConfirmedViolationCount as number) >= 2)) {
    fail('Moderation decision result requires exact fields.');
  }
}
