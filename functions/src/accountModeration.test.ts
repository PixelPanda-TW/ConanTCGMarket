import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_MODERATION_AUDIT_TYPES,
  ACCOUNT_MODERATION_OPERATION_STATUSES,
  isAccountModerationRequestId,
  readAccountModerationAuditEvent,
  readAccountModerationOperation,
} from './accountModeration.js';

const CREATED_AT = Timestamp.fromDate(new Date('2026-09-05T00:00:00.000Z'));
const LATER_AT = Timestamp.fromMillis(CREATED_AT.toMillis() + 1000);
const requestKey = 'a'.repeat(64);

const commonOperation = {
  actionId: 'action-1', targetUid: 'seller-1', sourceReportId: 'report-1',
  requestedBy: 'admin-1', reason: '重複違規', requestKey,
  confirmedViolationCount: 2, hiddenListingCount: 0,
  createdAt: CREATED_AT, updatedAt: CREATED_AT,
};

describe('account moderation contracts', () => {
  it('defines exact operation states, audit variants, and UUID request IDs', () => {
    expect(ACCOUNT_MODERATION_OPERATION_STATUSES).toEqual(['hiding', 'suspended', 'restored']);
    expect(ACCOUNT_MODERATION_AUDIT_TYPES).toEqual([
      'suspension_requested', 'suspension_completed', 'restored', 'listing_republished',
    ]);
    expect(isAccountModerationRequestId('018f47a8-7b2c-7a24-bf6f-3c5ee6f25a42')).toBe(true);
    expect(isAccountModerationRequestId('not-a-uuid')).toBe(false);
  });

  it('reads exact hiding, suspended, and restored operations', () => {
    expect(readAccountModerationOperation({ status: 'hiding', ...commonOperation }))
      .toMatchObject({ status: 'hiding', hiddenListingCount: 0 });
    expect(readAccountModerationOperation({
      status: 'suspended', ...commonOperation, hiddenListingCount: 3,
      completedAt: LATER_AT, updatedAt: LATER_AT,
    })).toMatchObject({ status: 'suspended', hiddenListingCount: 3 });
    expect(readAccountModerationOperation({
      status: 'restored', ...commonOperation, hiddenListingCount: 3,
      completedAt: LATER_AT, restoredAt: LATER_AT, restoredBy: 'admin-2',
      restorationReason: '申訴確認', restorationRequestKey: 'b'.repeat(64),
      updatedAt: LATER_AT,
    })).toMatchObject({ status: 'restored', restoredBy: 'admin-2' });
  });

  it.each([
    ['extra field', { status: 'hiding', ...commonOperation, email: 'private@example.test' }],
    ['bad request key', { status: 'hiding', ...commonOperation, requestKey: 'short' }],
    ['padded reason', { status: 'hiding', ...commonOperation, reason: ' 原因' }],
    ['negative count', { status: 'hiding', ...commonOperation, hiddenListingCount: -1 }],
    ['completion on hiding', { status: 'hiding', ...commonOperation, completedAt: LATER_AT }],
    ['missing completion', { status: 'suspended', ...commonOperation }],
  ])('rejects malformed stored operation: %s', (_label, value) => {
    expect(() => readAccountModerationOperation(value)).toThrowError(
      expect.objectContaining({ code: 'failed-precondition' }),
    );
  });

  it('reads strict create-only audit event variants', () => {
    const common = {
      targetUid: 'seller-1', suspensionActionId: 'action-1',
      sourceReportId: 'report-1', actorUid: 'admin-1', at: CREATED_AT,
    };
    expect(readAccountModerationAuditEvent({
      ...common, eventId: 'event-1', type: 'suspension_requested',
      reason: '重複違規', confirmedViolationCount: 2,
    })).toMatchObject({ type: 'suspension_requested' });
    expect(readAccountModerationAuditEvent({
      ...common, eventId: 'event-2', type: 'suspension_completed', hiddenListingCount: 3,
    })).toMatchObject({ type: 'suspension_completed' });
    expect(readAccountModerationAuditEvent({
      ...common, eventId: 'event-3', type: 'restored', reason: '申訴確認',
    })).toMatchObject({ type: 'restored' });
    expect(readAccountModerationAuditEvent({
      ...common, eventId: 'event-4', type: 'listing_republished',
      actorUid: 'seller-1', listingId: 'listing-1',
    })).toMatchObject({ type: 'listing_republished' });
  });

  it.each(['email', 'contactValue', 'description', 'evidence']) (
    'rejects private or extra audit field %s',
    (field) => {
      expect(() => readAccountModerationAuditEvent({
        eventId: 'event-1', type: 'restored', targetUid: 'seller-1',
        suspensionActionId: 'action-1', sourceReportId: 'report-1',
        actorUid: 'admin-1', reason: '恢復原因', at: CREATED_AT, [field]: 'private',
      })).toThrowError(expect.objectContaining({ code: 'failed-precondition' }));
    },
  );
});
