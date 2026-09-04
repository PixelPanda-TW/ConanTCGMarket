export const REQUESTER_HOURLY_CONTACT_LIMIT = 60;
export const SELLER_HOURLY_CONTACT_LIMIT = 300;

type ContactType = 'line' | 'discord' | 'threads' | 'facebook';
type ErrorCode =
  | 'unauthenticated'
  | 'permission-denied'
  | 'invalid-argument'
  | 'not-found'
  | 'resource-exhausted'
  | 'unavailable';

export class SecureSellerProfileError extends Error {
  constructor(public readonly code: ErrorCode, message: string) {
    super(message);
    this.name = 'SecureSellerProfileError';
  }
}

export interface ContactAccessAudit {
  id: string;
  requesterUid: string;
  sellerUid?: string;
  listingId: string;
  outcome: 'revealed' | 'rate_limited' | 'unavailable';
  createdAt: Date;
}

interface StoredPublicProfile {
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
}

interface StoredSellerContact {
  contactType: ContactType;
  contactValue: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SecureSellerProfileTransaction {
  getAccountAccess(uid: string): Promise<unknown | null>;
  getPublicProfile(uid: string): Promise<Record<string, unknown> | null>;
  getSellerContact(uid: string): Promise<Record<string, unknown> | null>;
  getListing(id: string): Promise<Record<string, unknown> | null>;
  getRequesterCount(key: string): Promise<number>;
  getSellerCount(key: string): Promise<number>;
  saveProfilePair(
    uid: string,
    profile: StoredPublicProfile,
    contact: StoredSellerContact,
  ): void;
  setRequesterCount(key: string, count: number): void;
  setSellerCount(key: string, count: number): void;
  createAudit(audit: ContactAccessAudit): void;
}

export interface SecureSellerProfileDependencies {
  now(): Date;
  randomId(): string;
  runTransaction<T>(
    operation: (transaction: SecureSellerProfileTransaction) => Promise<T>,
  ): Promise<T>;
  writeAudit(audit: ContactAccessAudit): Promise<void>;
}

interface CallableRequest {
  authUid: string | null;
  data: unknown;
}

interface SellerProfileWire {
  uid: string;
  displayName: string;
  contactType: ContactType;
  contactValue: string;
  createdAt: number;
  updatedAt: number;
}

interface SellerContactWire {
  contactType: ContactType;
  contactValue: string;
}

const contactTypes = new Set<ContactType>(['line', 'discord', 'threads', 'facebook']);
const identifierUrlPrefix = /^(?:[a-z][a-z\d+.-]*:|www\.|line\.me(?:\/|$)|discord\.(?:com|gg)(?:\/|$))/iu;
const facebookHosts = new Set(['facebook.com', 'www.facebook.com', 'm.facebook.com']);
const threadsHosts = new Set(['threads.net', 'www.threads.net']);
const reservedFacebookPaths = new Set(['events', 'groups', 'marketplace', 'pages', 'reel', 'share', 'watch']);

function invalidArgument(message = '請檢查輸入資料。'): never {
  throw new SecureSellerProfileError('invalid-argument', message);
}

function assertExactObject(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalidArgument();
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== fields.length || !fields.every((field) => keys.includes(field))) invalidArgument();
  return record;
}

function requireAuthUid(authUid: string | null): string {
  if (typeof authUid !== 'string' || authUid.length < 1 || authUid.length > 128 || authUid.trim() !== authUid) {
    throw new SecureSellerProfileError('unauthenticated', '請先使用 Google 登入。');
  }
  return authUid;
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.valueOf());
}

function hasExactFields(record: Record<string, unknown>, fields: readonly string[]) {
  const keys = Object.keys(record);
  return keys.length === fields.length && fields.every((field) => keys.includes(field));
}

function isCanonicalActiveAccess(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const access = value as Record<string, unknown>;
  return hasExactFields(access, ['status', 'confirmedViolationCount', 'updatedAt'])
    && access.status === 'active'
    && Number.isInteger(access.confirmedViolationCount)
    && (access.confirmedViolationCount as number) >= 0
    && validDate(access.updatedAt);
}

async function requireActiveAccount(transaction: SecureSellerProfileTransaction, uid: string) {
  const access = await transaction.getAccountAccess(uid);
  if (access !== null && !isCanonicalActiveAccess(access)) {
    throw new SecureSellerProfileError('permission-denied', '此帳號目前無法執行這項操作。');
  }
}

function normalizePathSegments(pathname: string): string[] | null {
  const raw = pathname.split('/');
  if (raw.shift() !== '') return null;
  if (raw.at(-1) === '') raw.pop();
  if (raw.length === 0 || raw.some((segment) => segment.length === 0)) return null;
  try {
    const decoded = raw.map((segment) => decodeURIComponent(segment));
    return decoded.some((segment) => segment.length === 0 || /[/?#]/u.test(segment)) ? null : decoded;
  } catch {
    return null;
  }
}

function parseSecureUrl(rawValue: string, hosts: ReadonlySet<string>): URL | null {
  try {
    const url = new URL(rawValue);
    return url.protocol === 'https:'
      && hosts.has(url.hostname.toLowerCase())
      && url.username === ''
      && url.password === ''
      && url.port === ''
      && url.hash === '' ? url : null;
  } catch {
    return null;
  }
}

function normalizeContact(contactType: unknown, rawValue: unknown): StoredSellerContact['contactValue'] {
  if (typeof contactType !== 'string' || !contactTypes.has(contactType as ContactType) || typeof rawValue !== 'string') {
    invalidArgument('請提供有效的聯絡方式。');
  }
  const value = rawValue.trim();
  if (value.length === 0) invalidArgument('請提供有效的聯絡方式。');
  if (contactType === 'line' || contactType === 'discord') {
    if (Array.from(value).length > 100 || /\s/u.test(value) || identifierUrlPrefix.test(value)) {
      invalidArgument('請提供有效的聯絡方式。');
    }
    return value;
  }
  if (contactType === 'facebook') {
    const url = parseSecureUrl(value, facebookHosts);
    const segments = url ? normalizePathSegments(url.pathname) : null;
    if (!url || !segments) invalidArgument('請提供有效的聯絡方式。');
    if (segments.length === 1 && segments[0].toLowerCase() !== 'profile.php') {
      if (url.search || reservedFacebookPaths.has(segments[0].toLowerCase())) invalidArgument('請提供有效的聯絡方式。');
      return `https://www.facebook.com/${encodeURIComponent(segments[0])}`;
    }
    const query = [...url.searchParams.entries()];
    if (segments.length === 1 && segments[0].toLowerCase() === 'profile.php'
      && query.length === 1 && query[0][0] === 'id' && query[0][1].trim()) {
      return `https://www.facebook.com/profile.php?id=${encodeURIComponent(query[0][1].trim())}`;
    }
    invalidArgument('請提供有效的聯絡方式。');
  }
  const url = parseSecureUrl(value, threadsHosts);
  const segments = url ? normalizePathSegments(url.pathname) : null;
  if (!url || url.search || !segments || segments.length !== 1 || !segments[0].startsWith('@')) {
    invalidArgument('請提供有效的聯絡方式。');
  }
  const handle = segments[0].slice(1);
  if (!handle || /\s/u.test(handle)) invalidArgument('請提供有效的聯絡方式。');
  return `https://www.threads.net/@${encodeURIComponent(handle)}`;
}

function parseSaveInput(data: unknown) {
  const input = assertExactObject(data, ['displayName', 'contactType', 'contactValue']);
  if (typeof input.displayName !== 'string') invalidArgument();
  const displayName = input.displayName.trim();
  if (displayName.length < 1 || displayName.length > 80) invalidArgument('顯示名稱必須為 1 到 80 個字元。');
  const contactValue = normalizeContact(input.contactType, input.contactValue);
  return { displayName, contactType: input.contactType as ContactType, contactValue };
}

function readPublicProfile(value: Record<string, unknown> | null): StoredPublicProfile | null {
  if (!value || !hasExactFields(value, ['displayName', 'createdAt', 'updatedAt'])
    || typeof value.displayName !== 'string' || value.displayName.length < 1 || value.displayName.length > 80
    || value.displayName.trim() !== value.displayName || !validDate(value.createdAt) || !validDate(value.updatedAt)) {
    return null;
  }
  return value as unknown as StoredPublicProfile;
}

function readContact(value: Record<string, unknown> | null): StoredSellerContact | null {
  if (!value || !hasExactFields(value, ['contactType', 'contactValue', 'createdAt', 'updatedAt'])
    || !validDate(value.createdAt) || !validDate(value.updatedAt)) return null;
  try {
    const contactValue = normalizeContact(value.contactType, value.contactValue);
    if (contactValue !== value.contactValue) return null;
    return { ...value, contactType: value.contactType as ContactType, contactValue } as StoredSellerContact;
  } catch {
    return null;
  }
}

function profileWire(uid: string, profile: StoredPublicProfile, contact: StoredSellerContact): SellerProfileWire {
  return {
    uid,
    displayName: profile.displayName,
    contactType: contact.contactType,
    contactValue: contact.contactValue,
    createdAt: profile.createdAt.valueOf(),
    updatedAt: profile.updatedAt.valueOf(),
  };
}

export function getUtcHourBucket(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}`;
}

export async function handleSaveSellerProfile(
  request: CallableRequest,
  dependencies: SecureSellerProfileDependencies,
): Promise<SellerProfileWire> {
  const uid = requireAuthUid(request.authUid);
  const input = parseSaveInput(request.data);
  const now = dependencies.now();
  return dependencies.runTransaction(async (transaction) => {
    await requireActiveAccount(transaction, uid);
    const existingProfile = readPublicProfile(await transaction.getPublicProfile(uid));
    const existingContact = readContact(await transaction.getSellerContact(uid));
    const profile = {
      displayName: input.displayName,
      createdAt: existingProfile?.createdAt ?? now,
      updatedAt: now,
    };
    const contact = {
      contactType: input.contactType,
      contactValue: input.contactValue,
      createdAt: existingContact?.createdAt ?? now,
      updatedAt: now,
    };
    transaction.saveProfilePair(uid, profile, contact);
    return profileWire(uid, profile, contact);
  });
}

export async function handleGetOwnSellerProfile(
  request: CallableRequest,
  dependencies: SecureSellerProfileDependencies,
): Promise<SellerProfileWire | null> {
  const uid = requireAuthUid(request.authUid);
  assertExactObject(request.data, []);
  return dependencies.runTransaction(async (transaction) => {
    await requireActiveAccount(transaction, uid);
    const profile = readPublicProfile(await transaction.getPublicProfile(uid));
    const contact = readContact(await transaction.getSellerContact(uid));
    return profile && contact ? profileWire(uid, profile, contact) : null;
  });
}

function parseListingId(data: unknown): string {
  const input = assertExactObject(data, ['listingId']);
  if (typeof input.listingId !== 'string') invalidArgument();
  const listingId = input.listingId.trim();
  if (listingId.length < 1 || listingId.length > 128) invalidArgument('商品 ID 格式錯誤。');
  return listingId;
}

function unavailableError() {
  return new SecureSellerProfileError('not-found', '無法提供此商品的聯絡方式。');
}

export async function handleGetSellerContact(
  request: CallableRequest,
  dependencies: SecureSellerProfileDependencies,
): Promise<SellerContactWire> {
  const uid = requireAuthUid(request.authUid);
  const listingId = parseListingId(request.data);
  const now = dependencies.now();
  const bucket = getUtcHourBucket(now);

  try {
    const result = await dependencies.runTransaction(async (transaction) => {
      await requireActiveAccount(transaction, uid);
      const rawListing = await transaction.getListing(listingId);
      const listing = rawListing && typeof rawListing === 'object' ? rawListing : null;
      const sellerUid = listing && typeof listing.sellerId === 'string'
        && listing.sellerId.length >= 1 && listing.sellerId.length <= 128
        && listing.sellerId.trim() === listing.sellerId ? listing.sellerId : undefined;
      if (!listing || !sellerUid || listing.status !== 'active'
        || !Number.isInteger(listing.remainingQuantity) || (listing.remainingQuantity as number) <= 0) {
        transaction.createAudit({
          id: dependencies.randomId(), requesterUid: uid, listingId,
          outcome: 'unavailable', createdAt: now,
        });
        return { kind: 'unavailable' } as const;
      }
      const profile = readPublicProfile(await transaction.getPublicProfile(sellerUid));
      const contact = readContact(await transaction.getSellerContact(sellerUid));
      if (!profile || !contact) {
        transaction.createAudit({
          id: dependencies.randomId(), requesterUid: uid, sellerUid, listingId,
          outcome: 'unavailable', createdAt: now,
        });
        return { kind: 'unavailable' } as const;
      }
      const requesterKey = `${uid}:${bucket}`;
      const sellerKey = `${sellerUid}:${bucket}`;
      const [requesterCount, sellerCount] = await Promise.all([
        transaction.getRequesterCount(requesterKey),
        transaction.getSellerCount(sellerKey),
      ]);
      if (!Number.isInteger(requesterCount) || requesterCount < 0
        || !Number.isInteger(sellerCount) || sellerCount < 0) {
        throw new Error('Malformed contact access counter.');
      }
      if (requesterCount >= REQUESTER_HOURLY_CONTACT_LIMIT
        || sellerCount >= SELLER_HOURLY_CONTACT_LIMIT) {
        transaction.createAudit({
          id: dependencies.randomId(), requesterUid: uid, sellerUid, listingId,
          outcome: 'rate_limited', createdAt: now,
        });
        return { kind: 'rate-limited' } as const;
      }
      transaction.setRequesterCount(requesterKey, requesterCount + 1);
      transaction.setSellerCount(sellerKey, sellerCount + 1);
      transaction.createAudit({
        id: dependencies.randomId(), requesterUid: uid, sellerUid, listingId,
        outcome: 'revealed', createdAt: now,
      });
      return { kind: 'revealed', contact } as const;
    });

    if (result.kind === 'unavailable') throw unavailableError();
    if (result.kind === 'rate-limited') {
      throw new SecureSellerProfileError('resource-exhausted', '本時段查看次數已達上限，請稍後再試。');
    }
    return { contactType: result.contact.contactType, contactValue: result.contact.contactValue };
  } catch (error) {
    if (error instanceof SecureSellerProfileError) throw error;
    try {
      await dependencies.writeAudit({
        id: dependencies.randomId(), requesterUid: uid, listingId,
        outcome: 'unavailable', createdAt: now,
      });
    } catch {
      // The original storage failure remains authoritative and no contact is returned.
    }
    throw new SecureSellerProfileError('unavailable', '目前無法讀取聯絡方式，請稍後再試。');
  }
}
