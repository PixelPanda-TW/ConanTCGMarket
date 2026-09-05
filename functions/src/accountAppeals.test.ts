import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import {
  AccountAppealError,
  parseAccountAppealDecisionRequest,
  parseAccountAppealSubmissionRequest,
  readStoredAccountAppeal,
} from './accountAppeals.js';

const uuid = '123e4567-e89b-42d3-a456-426614174000';
const statement = '請重新審查這次停權，相關交易紀錄與說明如附件所示。'.repeat(5);

describe('account appeal contracts', () => {
  it('parses an exact bounded submission and evidence metadata', () => {
    expect(parseAccountAppealSubmissionRequest({
      suspensionActionId: 'action-1', requestId: uuid, draftId: uuid, statement,
      evidence: [{ slot: 0, generation: '123', contentType: 'image/png', size: 1024 }],
    })).toMatchObject({ suspensionActionId: 'action-1', statement });
  });

  it('rejects unknown fields, duplicate slots, invalid MIME, size, and text', () => {
    const base = { suspensionActionId: 'action-1', requestId: uuid, draftId: uuid, statement };
    for (const data of [
      { ...base, evidence: [], unknown: true },
      { ...base, evidence: [{ slot: 0, generation: '1', contentType: 'image/gif', size: 1 }] },
      { ...base, evidence: [{ slot: 0, generation: '1', contentType: 'image/png', size: 6 * 1024 * 1024 }] },
      { ...base, evidence: [0, 0].map(() => ({ slot: 0, generation: '1', contentType: 'image/png', size: 1 })) },
      { ...base, statement: 'short', evidence: [] },
    ]) expect(() => parseAccountAppealSubmissionRequest(data)).toThrow(AccountAppealError);
  });

  it('parses exact final decisions and rejects unsupported outcomes', () => {
    expect(parseAccountAppealDecisionRequest({
      appealId: 'appeal-1', requestId: uuid, decision: 'approved', rationale: '人工複核完成。',
    }).decision).toBe('approved');
    expect(() => parseAccountAppealDecisionRequest({
      appealId: 'appeal-1', requestId: uuid, decision: 'reopen', rationale: '人工複核完成。',
    })).toThrow(AccountAppealError);
  });

  it('reads exact timestamp-backed stored variants and rejects secret fields', () => {
    const value = {
      appealId: 'appeal-1', status: 'submitted', targetUid: 'seller-1',
      suspensionActionId: 'action-1', statement, evidence: [], requestKey: 'a'.repeat(64),
      submittedAt: Timestamp.fromMillis(1), updatedAt: Timestamp.fromMillis(1),
    };
    expect(readStoredAccountAppeal(value).status).toBe('submitted');
    expect(() => readStoredAccountAppeal({ ...value, email: 'secret@example.com' }))
      .toThrow(AccountAppealError);
  });
});
