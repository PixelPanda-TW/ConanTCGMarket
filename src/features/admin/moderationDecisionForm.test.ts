import { describe, expect, it } from 'vitest';
import { validateModerationDecisionForm } from './moderationDecisionForm';

describe('moderation decision form', () => {
  it('normalizes a bounded rationale for either terminal decision', () => {
    expect(validateModerationDecisionForm({
      decision: 'confirmed', rationale: '  證據與刊登內容不符  ',
    })).toEqual({
      values: { decision: 'confirmed', rationale: '證據與刊登內容不符' }, errors: {},
    });
    expect(validateModerationDecisionForm({
      decision: 'dismissed', rationale: '證據不足',
    }).errors).toEqual({});
  });

  it.each([
    ['', '請填寫裁決理由。'],
    ['   ', '請填寫裁決理由。'],
    ['理'.repeat(1001), '裁決理由須為 1 到 1000 字。'],
  ])('rejects invalid rationale without authorizing a decision', (rationale, message) => {
    expect(validateModerationDecisionForm({ decision: 'dismissed', rationale })).toEqual({
      values: { decision: 'dismissed', rationale: rationale.trim() },
      errors: { rationale: message },
    });
  });
});
