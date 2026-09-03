import type { ContactType } from './models';

export type ContactValidationReason = 'required' | 'identifier' | 'profile-url';

export type ContactValidationResult =
  | { ok: true; value: string }
  | { ok: false; reason: ContactValidationReason };

export interface SellerContactFieldDefinition {
  label: string;
  helper: string;
  placeholder: string;
  inputMode: 'text' | 'url';
  invalidMessage: string;
}

export interface SellerContactPresentation {
  label: string;
  value: string;
  href?: string;
  isValid: boolean;
}

const fieldDefinitions: Record<ContactType, SellerContactFieldDefinition> = {
  line: {
    label: 'LINE ID',
    helper: '請填寫 LINE ID，不要貼網址。',
    placeholder: '例如：@conanmarket',
    inputMode: 'text',
    invalidMessage: '請填寫 LINE ID，不要使用網址或空白。',
  },
  discord: {
    label: 'Discord ID',
    helper: '只會顯示 ID 文字，不會建立連結。',
    placeholder: '例如：conan_seller',
    inputMode: 'text',
    invalidMessage: '請填寫 Discord ID，不要使用網址或空白。',
  },
  facebook: {
    label: 'Facebook 個人頁面連結',
    helper: '必須是 facebook.com 的個人頁面 HTTPS 連結。',
    placeholder: 'https://www.facebook.com/username',
    inputMode: 'url',
    invalidMessage: '請填寫有效的 Facebook 個人頁面 HTTPS 連結。',
  },
  threads: {
    label: 'Threads 個人頁面連結',
    helper: '必須是 threads.net/@帳號 的個人頁面 HTTPS 連結。',
    placeholder: 'https://www.threads.net/@username',
    inputMode: 'url',
    invalidMessage: '請填寫有效的 Threads 個人頁面 HTTPS 連結。',
  },
};

const identifierUrlPrefix = /^(?:[a-z][a-z\d+.-]*:|www\.|line\.me(?:\/|$)|discord\.(?:com|gg)(?:\/|$))/iu;
const facebookHosts = new Set(['facebook.com', 'www.facebook.com', 'm.facebook.com']);
const threadsHosts = new Set(['threads.net', 'www.threads.net']);
const reservedFacebookPaths = new Set([
  'events',
  'groups',
  'marketplace',
  'pages',
  'reel',
  'share',
  'watch',
]);

function invalid(reason: ContactValidationReason): ContactValidationResult {
  return { ok: false, reason };
}

function normalizedPathSegments(pathname: string): string[] | null {
  const rawSegments = pathname.split('/');
  if (rawSegments[0] !== '') return null;
  rawSegments.shift();
  if (rawSegments.at(-1) === '') rawSegments.pop();
  if (rawSegments.length === 0 || rawSegments.some((segment) => segment.length === 0)) return null;

  try {
    const decoded = rawSegments.map((segment) => decodeURIComponent(segment));
    if (decoded.some((segment) => segment.length === 0 || /[/?#]/u.test(segment))) return null;
    return decoded;
  } catch {
    return null;
  }
}

function parseSecureProfileUrl(rawValue: string, hosts: ReadonlySet<string>): URL | null {
  let url: URL;
  try {
    url = new URL(rawValue);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:'
    || !hosts.has(url.hostname.toLowerCase())
    || url.username.length > 0
    || url.password.length > 0
    || url.port.length > 0
    || url.hash.length > 0) {
    return null;
  }
  return url;
}

function normalizeIdentifier(rawValue: string): ContactValidationResult {
  const value = rawValue.trim();
  if (value.length === 0) return invalid('required');
  if (Array.from(value).length > 100 || /\s/u.test(value) || identifierUrlPrefix.test(value)) {
    return invalid('identifier');
  }
  return { ok: true, value };
}

function normalizeFacebook(rawValue: string): ContactValidationResult {
  const value = rawValue.trim();
  if (value.length === 0) return invalid('required');
  const url = parseSecureProfileUrl(value, facebookHosts);
  if (!url) return invalid('profile-url');

  const segments = normalizedPathSegments(url.pathname);
  if (!segments) return invalid('profile-url');

  if (segments.length === 1 && segments[0].toLowerCase() !== 'profile.php') {
    if (url.search.length > 0 || reservedFacebookPaths.has(segments[0].toLowerCase())) {
      return invalid('profile-url');
    }
    return { ok: true, value: `https://www.facebook.com/${encodeURIComponent(segments[0])}` };
  }

  const queryEntries = [...url.searchParams.entries()];
  if (segments.length === 1
    && segments[0].toLowerCase() === 'profile.php'
    && queryEntries.length === 1
    && queryEntries[0][0] === 'id'
    && queryEntries[0][1].trim().length > 0) {
    return {
      ok: true,
      value: `https://www.facebook.com/profile.php?id=${encodeURIComponent(queryEntries[0][1].trim())}`,
    };
  }

  return invalid('profile-url');
}

function normalizeThreads(rawValue: string): ContactValidationResult {
  const value = rawValue.trim();
  if (value.length === 0) return invalid('required');
  const url = parseSecureProfileUrl(value, threadsHosts);
  if (!url || url.search.length > 0) return invalid('profile-url');

  const segments = normalizedPathSegments(url.pathname);
  if (!segments || segments.length !== 1 || !segments[0].startsWith('@')) {
    return invalid('profile-url');
  }
  const handle = segments[0].slice(1);
  if (handle.length === 0 || /\s/u.test(handle)) return invalid('profile-url');

  return { ok: true, value: `https://www.threads.net/@${encodeURIComponent(handle)}` };
}

export function normalizeAndValidateContact(
  contactType: ContactType,
  rawValue: string,
): ContactValidationResult {
  switch (contactType) {
    case 'line':
    case 'discord':
      return normalizeIdentifier(rawValue);
    case 'facebook':
      return normalizeFacebook(rawValue);
    case 'threads':
      return normalizeThreads(rawValue);
  }
}

export function sellerContactFieldDefinition(contactType: ContactType): SellerContactFieldDefinition {
  return fieldDefinitions[contactType];
}

export function sellerContactPresentation(
  contactType: ContactType,
  contactValue: string,
): SellerContactPresentation {
  const result = normalizeAndValidateContact(contactType, contactValue);
  if (!result.ok) {
    return { label: '聯絡方式需要由賣家更新', value: '', isValid: false };
  }

  switch (contactType) {
    case 'line':
      return {
        label: 'LINE ID',
        value: result.value,
        href: `https://line.me/ti/p/~${encodeURIComponent(result.value)}`,
        isValid: true,
      };
    case 'discord':
      return { label: 'Discord ID', value: result.value, isValid: true };
    case 'facebook':
      return { label: 'Facebook 個人頁面', value: '', href: result.value, isValid: true };
    case 'threads':
      return { label: 'Threads 個人頁面', value: '', href: result.value, isValid: true };
  }
}
