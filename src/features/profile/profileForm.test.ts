import { describe, expect, it } from 'vitest';
import {
  canApplyProfileRequest,
  normalizeProfileForm,
  validateProfileForm,
} from './profileForm';

describe('seller profile form', () => {
  it('rejects a display name longer than 80 characters', () => {
    expect(validateProfileForm({
      displayName: '名'.repeat(81), contactType: 'line', contactValue: 'aming',
    }).errors).toEqual({ displayName: '顯示名稱最多 80 個字元。' });
  });

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

  it.each([
    ['facebook', 'https://m.facebook.com/conan.seller/', 'https://www.facebook.com/conan.seller'],
    ['threads', 'https://threads.net/@conan.seller/', 'https://www.threads.net/@conan.seller'],
  ] as const)('canonicalizes a valid %s profile URL', (contactType, contactValue, expected) => {
    expect(validateProfileForm({
      displayName: '阿明',
      contactType,
      contactValue,
    })).toEqual({
      values: { displayName: '阿明', contactType, contactValue: expected },
      errors: {},
    });
  });

  it.each([
    ['line', 'https://line.me/ti/p/~seller', '請填寫 LINE ID，不要使用網址或空白。'],
    ['line', 'seller id', '請填寫 LINE ID，不要使用網址或空白。'],
    ['discord', 'discord.gg/seller', '請填寫 Discord ID，不要使用網址或空白。'],
    ['discord', 'seller id', '請填寫 Discord ID，不要使用網址或空白。'],
    ['facebook', 'https://facebook.com/groups/conan', '請填寫有效的 Facebook 個人頁面 HTTPS 連結。'],
    ['threads', '@conan', '請填寫有效的 Threads 個人頁面 HTTPS 連結。'],
  ] as const)('returns an actionable error for invalid %s contact', (contactType, contactValue, message) => {
    expect(validateProfileForm({
      displayName: '阿明',
      contactType,
      contactValue,
    }).errors).toEqual({ contactValue: message });
  });

  it('uses the required error instead of a format error for a blank contact', () => {
    expect(validateProfileForm({
      displayName: '阿明',
      contactType: 'threads',
      contactValue: '   ',
    }).errors).toEqual({ contactValue: '請填寫聯絡方式。' });
  });

  it('only applies async results while the same seller page is mounted', () => {
    expect(canApplyProfileRequest(true, 'seller-1', 'seller-1')).toBe(true);
    expect(canApplyProfileRequest(false, 'seller-1', 'seller-1')).toBe(false);
    expect(canApplyProfileRequest(true, 'seller-1', 'seller-2')).toBe(false);
  });
});
