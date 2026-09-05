import { describe, expect, it } from 'vitest';
import {
  validateAccountAppealDetail,
  validateAccountAppealPage,
  type AccountAppealDetail,
} from './accountAppeal';

const submitted = (): AccountAppealDetail => ({
  appealId: 'appeal-1',
  status: 'submitted',
  targetUid: 'seller-1',
  suspensionActionId: 'action-1',
  statement: '請重新審查這次停權，相關交易紀錄與說明如附件所示。'.repeat(5),
  evidence: [{ slot: 0, contentType: 'image/png', size: 1024 }],
  submittedAt: new Date('2026-09-05T00:00:00Z'),
  updatedAt: new Date('2026-09-05T00:00:00Z'),
});

describe('account appeal domain', () => {
  it('accepts exact submitted, dismissed, and approved details', () => {
    expect(() => validateAccountAppealDetail(submitted())).not.toThrow();
    for (const status of ['dismissed', 'approved'] as const) {
      expect(() => validateAccountAppealDetail({
        ...submitted(), status,
        decidedAt: new Date('2026-09-06T00:00:00Z'), decidedBy: 'admin-1',
        decisionRationale: '已完成人工複核。', updatedAt: new Date('2026-09-06T00:00:00Z'),
      })).not.toThrow();
    }
  });

  it('rejects unknown fields, invalid text, evidence, and date order', () => {
    expect(() => validateAccountAppealDetail({ ...submitted(), secret: 'no' })).toThrow();
    expect(() => validateAccountAppealDetail({ ...submitted(), statement: '太短' })).toThrow();
    expect(() => validateAccountAppealDetail({
      ...submitted(), evidence: [{ slot: 0, contentType: 'image/gif', size: 1 }],
    })).toThrow();
    expect(() => validateAccountAppealDetail({
      ...submitted(), updatedAt: new Date('2026-09-04T00:00:00Z'),
    })).toThrow();
  });

  it('validates bounded deterministic pages and their cursor', () => {
    const first = submitted();
    const second = { ...submitted(), appealId: 'appeal-0' };
    expect(() => validateAccountAppealPage({
      appeals: [first, second].map(({ statement: _statement, evidence: _evidence, ...item }) => ({
        ...item, evidenceCount: 1,
      })),
      nextCursor: { submittedAt: second.submittedAt, key: second.appealId },
    }, 2)).not.toThrow();
    expect(() => validateAccountAppealPage({ appeals: [], nextCursor: { key: 'x' } }, 2)).toThrow();
  });
});
