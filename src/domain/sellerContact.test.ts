import { describe, expect, it } from 'vitest';
import {
  normalizeAndValidateContact,
  sellerContactFieldDefinition,
  sellerContactPresentation,
} from './sellerContact';

describe('seller contact semantics', () => {
  it.each([
    ['line', '  @conan.market  ', '@conan.market'],
    ['discord', '  conan_seller  ', 'conan_seller'],
    ['facebook', 'https://m.facebook.com/conan.seller/', 'https://www.facebook.com/conan.seller'],
    ['facebook', 'https://facebook.com/profile.php?id=12345', 'https://www.facebook.com/profile.php?id=12345'],
    ['threads', 'https://threads.net/@conan.seller/', 'https://www.threads.net/@conan.seller'],
  ] as const)('normalizes a valid %s contact', (contactType, rawValue, value) => {
    expect(normalizeAndValidateContact(contactType, rawValue)).toEqual({ ok: true, value });
  });

  it.each([
    ['line', '   ', 'required'],
    ['discord', '', 'required'],
    ['line', 'conan seller', 'identifier'],
    ['discord', 'conan\tseller', 'identifier'],
    ['line', 'https://line.me/ti/p/~seller', 'identifier'],
    ['line', 'line.me/ti/p/~seller', 'identifier'],
    ['discord', 'discord.gg/example', 'identifier'],
    ['discord', `a${'字'.repeat(100)}`, 'identifier'],
  ] as const)('rejects invalid %s identifier %j', (contactType, rawValue, reason) => {
    expect(normalizeAndValidateContact(contactType, rawValue)).toEqual({ ok: false, reason });
  });

  it.each([
    ['facebook', 'http://facebook.com/conan', 'profile-url'],
    ['facebook', 'https://example.com/conan', 'profile-url'],
    ['facebook', 'https://user@facebook.com/conan', 'profile-url'],
    ['facebook', 'https://facebook.com:8443/conan', 'profile-url'],
    ['facebook', 'https://facebook.com/conan#about', 'profile-url'],
    ['facebook', 'https://facebook.com/conan?ref=test', 'profile-url'],
    ['facebook', 'https://facebook.com/', 'profile-url'],
    ['facebook', 'https://facebook.com/groups/conan', 'profile-url'],
    ['facebook', 'https://facebook.com/pages', 'profile-url'],
    ['facebook', 'https://facebook.com/profile.php', 'profile-url'],
    ['facebook', 'https://facebook.com/profile.php?id=123&ref=test', 'profile-url'],
    ['threads', 'http://threads.net/@conan', 'profile-url'],
    ['threads', 'https://example.com/@conan', 'profile-url'],
    ['threads', 'https://threads.net/conan', 'profile-url'],
    ['threads', 'https://threads.net/@', 'profile-url'],
    ['threads', 'https://threads.net/@conan/post/example', 'profile-url'],
    ['threads', 'https://threads.net/@conan?hl=zh-tw', 'profile-url'],
    ['threads', 'https://threads.net/@conan#profile', 'profile-url'],
  ] as const)('rejects non-profile %s URL %j', (contactType, rawValue, reason) => {
    expect(normalizeAndValidateContact(contactType, rawValue)).toEqual({ ok: false, reason });
  });

  it('provides exact accessible field guidance for every contact type', () => {
    expect(sellerContactFieldDefinition('line')).toEqual({
      label: 'LINE ID',
      helper: '請填寫 LINE ID，不要貼網址。',
      placeholder: '例如：@conanmarket',
      inputMode: 'text',
      invalidMessage: '請填寫 LINE ID，不要使用網址或空白。',
    });
    expect(sellerContactFieldDefinition('discord')).toEqual({
      label: 'Discord ID',
      helper: '只會顯示 ID 文字，不會建立連結。',
      placeholder: '例如：conan_seller',
      inputMode: 'text',
      invalidMessage: '請填寫 Discord ID，不要使用網址或空白。',
    });
    expect(sellerContactFieldDefinition('facebook')).toEqual({
      label: 'Facebook 個人頁面連結',
      helper: '必須是 facebook.com 的個人頁面 HTTPS 連結。',
      placeholder: 'https://www.facebook.com/username',
      inputMode: 'url',
      invalidMessage: '請填寫有效的 Facebook 個人頁面 HTTPS 連結。',
    });
    expect(sellerContactFieldDefinition('threads')).toEqual({
      label: 'Threads 個人頁面連結',
      helper: '必須是 threads.net/@帳號 的個人頁面 HTTPS 連結。',
      placeholder: 'https://www.threads.net/@username',
      inputMode: 'url',
      invalidMessage: '請填寫有效的 Threads 個人頁面 HTTPS 連結。',
    });
  });

  it('presents LINE as an encoded link and Discord as plain ID text', () => {
    expect(sellerContactPresentation('line', '@conan.market')).toEqual({
      label: 'LINE ID',
      value: '@conan.market',
      href: 'https://line.me/ti/p/~%40conan.market',
      isValid: true,
    });
    expect(sellerContactPresentation('discord', 'conan_seller')).toEqual({
      label: 'Discord ID',
      value: 'conan_seller',
      isValid: true,
    });
  });

  it('presents social profiles only through validated canonical URLs', () => {
    expect(sellerContactPresentation('facebook', 'https://facebook.com/conan.seller')).toEqual({
      label: 'Facebook 個人頁面',
      value: '',
      href: 'https://www.facebook.com/conan.seller',
      isValid: true,
    });
    expect(sellerContactPresentation('threads', 'https://threads.net/@conan.seller')).toEqual({
      label: 'Threads 個人頁面',
      value: '',
      href: 'https://www.threads.net/@conan.seller',
      isValid: true,
    });
  });

  it.each([
    ['threads', '@legacy'],
    ['facebook', 'javascript:alert(1)'],
    ['line', 'https://evil.example/contact'],
  ] as const)('never links an invalid legacy %s value', (contactType, value) => {
    expect(sellerContactPresentation(contactType, value)).toEqual({
      label: '聯絡方式需要由賣家更新',
      value: '',
      isValid: false,
    });
  });
});
