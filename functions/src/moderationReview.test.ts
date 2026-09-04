import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import {
  MODERATION_CASE_STATUSES,
  MODERATION_DECISIONS,
  parseDecideModerationCaseRequest,
  parseGetModerationCaseRequest,
  parseGetModerationEvidenceRequest,
  parseListModerationCasesRequest,
  readModerationCase,
} from './moderationReview.js';

const OPENED_AT = Timestamp.fromDate(new Date('2026-09-04T00:00:00.000Z'));

describe('moderation review contracts', () => {
  it('uses exact case statuses, decisions, and canonical requests', () => {
    expect(MODERATION_CASE_STATUSES).toEqual(['open', 'dismissed', 'confirmed']);
    expect(MODERATION_DECISIONS).toEqual(['dismissed', 'confirmed']);
    expect(parseListModerationCasesRequest({ status: 'open', limit: 20, cursor: null }))
      .toEqual({ status: 'open', limit: 20, cursor: null });
    expect(parseListModerationCasesRequest({ status: 'all' }))
      .toEqual({ status: 'all', limit: 20, cursor: null });
    expect(parseGetModerationCaseRequest({ reportId: 'report-1' }))
      .toEqual({ reportId: 'report-1' });
    expect(parseGetModerationEvidenceRequest({ reportId: 'report-1', slot: 2 }))
      .toEqual({ reportId: 'report-1', slot: 2 });
    expect(parseDecideModerationCaseRequest({
      reportId: 'report-1', decision: 'confirmed', rationale: '確認違規',
    })).toEqual({ reportId: 'report-1', decision: 'confirmed', rationale: '確認違規' });
  });

  it.each([
    ['unknown status', () => parseListModerationCasesRequest({ status: 'pending' })],
    ['limit zero', () => parseListModerationCasesRequest({ status: 'all', limit: 0 })],
    ['limit 51', () => parseListModerationCasesRequest({ status: 'all', limit: 51 })],
    ['invalid cursor', () => parseListModerationCasesRequest({
      status: 'all', cursor: { openedAt: -1, key: 'report-1' },
    })],
    ['extra list field', () => parseListModerationCasesRequest({ status: 'all', email: 'x@y.z' })],
    ['invalid report ID', () => parseGetModerationCaseRequest({ reportId: ' report-1' })],
    ['invalid evidence slot', () => parseGetModerationEvidenceRequest({ reportId: 'report-1', slot: 3 })],
    ['unknown decision', () => parseDecideModerationCaseRequest({
      reportId: 'report-1', decision: 'open', rationale: '原因',
    })],
    ['padded rationale', () => parseDecideModerationCaseRequest({
      reportId: 'report-1', decision: 'dismissed', rationale: ' 原因',
    })],
    ['long rationale', () => parseDecideModerationCaseRequest({
      reportId: 'report-1', decision: 'dismissed', rationale: '字'.repeat(1001),
    })],
  ])('rejects malformed moderation request: %s', (_label, operation) => {
    expect(operation).toThrowError(expect.objectContaining({ code: 'invalid-argument' }));
  });

  it('reads exact open, dismissed, and confirmed persisted cases', () => {
    expect(readModerationCase({
      status: 'open', reportId: 'report-1', targetSellerId: 'seller-1', openedAt: OPENED_AT,
    })).toMatchObject({ status: 'open' });
    expect(readModerationCase({
      status: 'dismissed', reportId: 'report-1', targetSellerId: 'seller-1',
      openedAt: OPENED_AT, rationale: '無法證實', decidedBy: 'admin-1', decidedAt: OPENED_AT,
    })).toMatchObject({ status: 'dismissed', rationale: '無法證實' });
    expect(readModerationCase({
      status: 'confirmed', reportId: 'report-1', targetSellerId: 'seller-1',
      openedAt: OPENED_AT, rationale: '確認違規', decidedBy: 'admin-1',
      decidedAt: OPENED_AT, resultingConfirmedViolationCount: 2,
    })).toMatchObject({ status: 'confirmed', resultingConfirmedViolationCount: 2 });
  });

  it.each([
    ['extra private field', { status: 'open', reportId: 'report-1', targetSellerId: 'seller-1', openedAt: OPENED_AT, email: 'private@example.test' }],
    ['missing rationale', { status: 'dismissed', reportId: 'report-1', targetSellerId: 'seller-1', openedAt: OPENED_AT, decidedBy: 'admin-1', decidedAt: OPENED_AT }],
    ['count on dismissed', { status: 'dismissed', reportId: 'report-1', targetSellerId: 'seller-1', openedAt: OPENED_AT, rationale: '原因', decidedBy: 'admin-1', decidedAt: OPENED_AT, resultingConfirmedViolationCount: 1 }],
    ['missing confirmed count', { status: 'confirmed', reportId: 'report-1', targetSellerId: 'seller-1', openedAt: OPENED_AT, rationale: '原因', decidedBy: 'admin-1', decidedAt: OPENED_AT }],
    ['padded actor', { status: 'dismissed', reportId: 'report-1', targetSellerId: 'seller-1', openedAt: OPENED_AT, rationale: '原因', decidedBy: ' admin-1', decidedAt: OPENED_AT }],
  ])('rejects malformed stored case: %s', (_label, value) => {
    expect(() => readModerationCase(value)).toThrowError(
      expect.objectContaining({ code: 'failed-precondition' }),
    );
  });
});
