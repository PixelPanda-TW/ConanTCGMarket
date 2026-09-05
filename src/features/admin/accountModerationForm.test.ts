import { describe, expect, it } from 'vitest';
import { validateAccountModerationForm } from './accountModerationForm';

describe('account moderation form', () => {
  it.each(['suspend', 'restore'] as const)('trims a bounded %s reason', (action) => {
    expect(validateAccountModerationForm({ action, reason: '  人工審查理由  ' })).toEqual({
      values: { action, reason: '人工審查理由' }, errors: {},
    });
  });

  it.each([
    ['', '請填寫處理理由。'],
    ['   ', '請填寫處理理由。'],
    ['理'.repeat(1001), '處理理由須為 1 到 1000 字。'],
  ])('rejects an invalid reason', (reason, message) => {
    expect(validateAccountModerationForm({ action: 'suspend', reason })).toEqual({
      values: { action: 'suspend', reason: reason.trim() }, errors: { reason: message },
    });
  });
});
