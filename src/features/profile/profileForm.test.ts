import { describe, expect, it } from 'vitest';
import {
  canApplyProfileRequest,
  normalizeProfileForm,
  validateProfileForm,
} from './profileForm';

describe('seller profile form', () => {
  it('trims display and contact values before saving', () => {
    expect(
      normalizeProfileForm({
        displayName: '  阿明  ',
        contactType: 'line',
        contactValue: '  aming  ',
      }),
    ).toEqual({
      displayName: '阿明',
      contactType: 'line',
      contactValue: 'aming',
    });
  });

  it('requires a display name and contact value after trimming whitespace', () => {
    expect(
      validateProfileForm({
        displayName: '   ',
        contactType: 'discord',
        contactValue: '\t',
      }).errors,
    ).toEqual({
      displayName: '請填寫顯示名稱。',
      contactValue: '請填寫聯絡方式。',
    });
  });

  it('rejects a contact type outside the supported marketplace options', () => {
    expect(
      validateProfileForm({
        displayName: '阿明',
        contactType: 'email' as never,
        contactValue: 'aming@example.com',
      }).errors,
    ).toEqual({
      contactType: '請選擇支援的聯絡方式。',
    });
  });

  it('only applies async results while the same seller page is mounted', () => {
    expect(canApplyProfileRequest(true, 'seller-1', 'seller-1')).toBe(true);
    expect(canApplyProfileRequest(false, 'seller-1', 'seller-1')).toBe(false);
    expect(canApplyProfileRequest(true, 'seller-1', 'seller-2')).toBe(false);
  });
});
