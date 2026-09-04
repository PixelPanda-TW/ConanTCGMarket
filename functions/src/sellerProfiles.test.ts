import { describe, expect, it, vi } from 'vitest';
import {
  REQUESTER_HOURLY_CONTACT_LIMIT,
  SELLER_HOURLY_CONTACT_LIMIT,
  SecureSellerProfileError,
  getUtcHourBucket,
  handleGetOwnSellerProfile,
  handleGetSellerContact,
  handleSaveSellerProfile,
  type ContactAccessAudit,
  type SecureSellerProfileDependencies,
  type SecureSellerProfileTransaction,
} from './sellerProfiles.js';

const NOW = new Date('2026-09-04T03:04:05.000Z');
const EARLIER = new Date('2026-08-01T00:00:00.000Z');

function activeAccess() {
  return { status: 'active', confirmedViolationCount: 0, updatedAt: EARLIER };
}

function publicProfile(displayName = '阿明') {
  return { displayName, createdAt: EARLIER, updatedAt: EARLIER };
}

function privateContact(contactType = 'line', contactValue = 'aming') {
  return { contactType, contactValue, createdAt: EARLIER, updatedAt: EARLIER };
}

function listing(overrides: Record<string, unknown> = {}) {
  return { sellerId: 'seller-1', status: 'active', remainingQuantity: 1, ...overrides };
}

interface MemoryState {
  access: Record<string, unknown | null>;
  profiles: Record<string, Record<string, unknown> | null>;
  contacts: Record<string, Record<string, unknown> | null>;
  listings: Record<string, Record<string, unknown> | null>;
  requesterCounts: Record<string, number>;
  sellerCounts: Record<string, number>;
  audits: ContactAccessAudit[];
  saved?: { uid: string; profile: Record<string, unknown>; contact: Record<string, unknown> };
}

function harness(initial: Partial<MemoryState> = {}) {
  const state: MemoryState = {
    access: { 'buyer-1': activeAccess(), 'seller-1': activeAccess() },
    profiles: { 'seller-1': publicProfile() },
    contacts: { 'seller-1': privateContact() },
    listings: { 'listing-1': listing() },
    requesterCounts: {},
    sellerCounts: {},
    audits: [],
    ...initial,
  };
  const transaction: SecureSellerProfileTransaction = {
    getAccountAccess: vi.fn(async (uid) => state.access[uid] ?? null),
    getPublicProfile: vi.fn(async (uid) => state.profiles[uid] ?? null),
    getSellerContact: vi.fn(async (uid) => state.contacts[uid] ?? null),
    getListing: vi.fn(async (id) => state.listings[id] ?? null),
    getRequesterCount: vi.fn(async (key) => state.requesterCounts[key] ?? 0),
    getSellerCount: vi.fn(async (key) => state.sellerCounts[key] ?? 0),
    saveProfilePair: vi.fn((uid, profile, contact) => {
      state.saved = { uid, profile, contact };
      state.profiles[uid] = profile;
      state.contacts[uid] = contact;
    }),
    setRequesterCount: vi.fn((key, count) => { state.requesterCounts[key] = count; }),
    setSellerCount: vi.fn((key, count) => { state.sellerCounts[key] = count; }),
    createAudit: vi.fn((audit) => { state.audits.push(audit); }),
  };
  const externalAudits: ContactAccessAudit[] = [];
  const dependencies: SecureSellerProfileDependencies = {
    now: () => NOW,
    randomId: () => 'audit-1',
    runTransaction: async (operation) => operation(transaction),
    writeAudit: async (audit) => { externalAudits.push(audit); },
  };
  return { state, transaction, dependencies, externalAudits };
}

function expectCode(operation: Promise<unknown>, code: string) {
  return expect(operation).rejects.toMatchObject({ code });
}

describe('secure seller profile workflows', () => {
  it('uses fixed UTC-hour buckets and documented limits', () => {
    expect(getUtcHourBucket(new Date('2026-09-04T23:59:59.999Z'))).toBe('2026090423');
    expect(getUtcHourBucket(new Date('2026-09-05T00:00:00.000Z'))).toBe('2026090500');
    expect(REQUESTER_HOURLY_CONTACT_LIMIT).toBe(60);
    expect(SELLER_HOURLY_CONTACT_LIMIT).toBe(300);
  });

  it.each([
    ['line', '  @aming  ', '@aming'],
    ['discord', '  aming.name  ', 'aming.name'],
    ['facebook', ' https://facebook.com/aming/ ', 'https://www.facebook.com/aming'],
    ['threads', ' https://threads.net/@aming/ ', 'https://www.threads.net/@aming'],
  ] as const)('normalizes %s while atomically saving public and private halves', async (
    contactType,
    contactValue,
    expected,
  ) => {
    const { state, dependencies } = harness({ profiles: {}, contacts: {} });

    await expect(handleSaveSellerProfile({
      authUid: 'seller-1',
      data: { displayName: ' 阿明 ', contactType, contactValue },
    }, dependencies)).resolves.toEqual({
      uid: 'seller-1', displayName: '阿明', contactType, contactValue: expected,
      createdAt: NOW.valueOf(), updatedAt: NOW.valueOf(),
    });
    expect(state.saved).toEqual({
      uid: 'seller-1',
      profile: { displayName: '阿明', createdAt: NOW, updatedAt: NOW },
      contact: { contactType, contactValue: expected, createdAt: NOW, updatedAt: NOW },
    });
  });

  it('preserves separate valid creation times and ignores client identity/timestamps', async () => {
    const contactCreated = new Date('2026-08-02T00:00:00.000Z');
    const { state, dependencies } = harness({
      profiles: { 'seller-1': publicProfile() },
      contacts: { 'seller-1': { ...privateContact(), createdAt: contactCreated } },
    });

    await handleSaveSellerProfile({
      authUid: 'seller-1',
      data: {
        displayName: '阿明', contactType: 'line', contactValue: 'aming',
      },
    }, dependencies);

    expect(state.saved?.profile.createdAt).toEqual(EARLIER);
    expect(state.saved?.contact.createdAt).toEqual(contactCreated);
    expect(state.saved?.profile.updatedAt).toEqual(NOW);
  });

  it.each([
    [null, { displayName: '阿明', contactType: 'line', contactValue: 'aming' }, 'unauthenticated'],
    ['seller-1', { displayName: '阿明', contactType: 'line' }, 'invalid-argument'],
    ['seller-1', { displayName: '名'.repeat(81), contactType: 'line', contactValue: 'aming' }, 'invalid-argument'],
    ['seller-1', { displayName: '阿明', contactType: 'line', contactValue: 'aming', uid: 'other' }, 'invalid-argument'],
  ])('rejects invalid save request %#', async (authUid, data, code) => {
    const { dependencies } = harness();
    await expectCode(handleSaveSellerProfile({ authUid, data }, dependencies), code);
  });

  it.each([
    ['suspended access', { status: 'suspended', confirmedViolationCount: 2, suspensionReason: 'reason', suspendedAt: EARLIER, suspendedBy: 'admin', updatedAt: EARLIER }],
    ['malformed active access', { status: 'active', confirmedViolationCount: 0, updatedAt: EARLIER, extra: true }],
  ])('denies %s for every protected workflow', async (_name, access) => {
    const { dependencies } = harness({ access: { 'buyer-1': access, 'seller-1': access } });

    await expectCode(handleSaveSellerProfile({
      authUid: 'seller-1', data: { displayName: '阿明', contactType: 'line', contactValue: 'aming' },
    }, dependencies), 'permission-denied');
    await expectCode(handleGetOwnSellerProfile({ authUid: 'seller-1', data: {} }, dependencies), 'permission-denied');
    await expectCode(handleGetSellerContact({
      authUid: 'buyer-1', data: { listingId: 'listing-1' },
    }, dependencies), 'permission-denied');
  });

  it('treats a missing account-access document as active', async () => {
    const { dependencies } = harness({ access: {} });
    await expect(handleGetOwnSellerProfile({ authUid: 'seller-1', data: {} }, dependencies))
      .resolves.toMatchObject({ uid: 'seller-1', displayName: '阿明' });
  });

  it('combines a valid own pair and returns null for absent or incomplete pairs', async () => {
    const valid = harness();
    await expect(handleGetOwnSellerProfile({ authUid: 'seller-1', data: {} }, valid.dependencies))
      .resolves.toEqual({
        uid: 'seller-1', displayName: '阿明', contactType: 'line', contactValue: 'aming',
        createdAt: EARLIER.valueOf(), updatedAt: EARLIER.valueOf(),
      });

    const missing = harness({ profiles: {}, contacts: {} });
    await expect(handleGetOwnSellerProfile({ authUid: 'seller-1', data: {} }, missing.dependencies))
      .resolves.toBeNull();
    const incomplete = harness({ contacts: {} });
    await expect(handleGetOwnSellerProfile({ authUid: 'seller-1', data: {} }, incomplete.dependencies))
      .resolves.toBeNull();
  });

  it('requires the exact empty own-profile payload', async () => {
    const { dependencies } = harness();
    await expectCode(handleGetOwnSellerProfile({
      authUid: 'seller-1', data: { uid: 'seller-1' },
    }, dependencies), 'invalid-argument');
  });

  it('reveals only canonical contact after deriving the active in-stock seller from Listing ID', async () => {
    const { state, transaction, dependencies } = harness();

    await expect(handleGetSellerContact({
      authUid: 'buyer-1', data: { listingId: ' listing-1 ' },
    }, dependencies)).resolves.toEqual({ contactType: 'line', contactValue: 'aming' });

    expect(transaction.getListing).toHaveBeenCalledWith('listing-1');
    expect(state.requesterCounts['buyer-1:2026090403']).toBe(1);
    expect(state.sellerCounts['seller-1:2026090403']).toBe(1);
    expect(state.audits).toEqual([{
      id: 'audit-1', requesterUid: 'buyer-1', sellerUid: 'seller-1',
      listingId: 'listing-1', outcome: 'revealed', createdAt: NOW,
    }]);
    expect(JSON.stringify(state.audits)).not.toContain('aming');
  });

  it.each([
    ['missing', null],
    ['inactive', listing({ status: 'sold_out' })],
    ['sold out', listing({ remainingQuantity: 0 })],
    ['malformed', listing({ sellerId: '' })],
  ])('returns one generic result and a contact-free audit for a %s Listing', async (_name, value) => {
    const { state, dependencies } = harness({ listings: { 'listing-1': value } });

    await expectCode(handleGetSellerContact({
      authUid: 'buyer-1', data: { listingId: 'listing-1' },
    }, dependencies), 'not-found');
    expect(state.audits[0]).toMatchObject({ requesterUid: 'buyer-1', outcome: 'unavailable' });
    expect(JSON.stringify(state.audits)).not.toContain('contactValue');
  });

  it.each([
    ['missing profile', {}, { 'seller-1': privateContact() }],
    ['missing contact', { 'seller-1': publicProfile() }, {}],
    ['malformed contact', { 'seller-1': publicProfile() }, { 'seller-1': privateContact('threads', '@legacy') }],
  ])('does not distinguish a %s disclosure failure', async (_name, profiles, contacts) => {
    const { dependencies } = harness({ profiles, contacts });
    await expect(handleGetSellerContact({
      authUid: 'buyer-1', data: { listingId: 'listing-1' },
    }, dependencies)).rejects.toEqual(new SecureSellerProfileError(
      'not-found', '無法提供此商品的聯絡方式。',
    ));
  });

  it.each([
    ['requester', REQUESTER_HOURLY_CONTACT_LIMIT, 0, 'buyer-1:2026090403'],
    ['seller', 0, SELLER_HOURLY_CONTACT_LIMIT, 'seller-1:2026090403'],
  ])('commits a contact-free rate-limit audit without incrementing the %s bucket', async (
    _scope,
    requesterCount,
    sellerCount,
    exhaustedKey,
  ) => {
    const { state, dependencies } = harness({
      requesterCounts: { 'buyer-1:2026090403': requesterCount },
      sellerCounts: { 'seller-1:2026090403': sellerCount },
    });

    await expectCode(handleGetSellerContact({
      authUid: 'buyer-1', data: { listingId: 'listing-1' },
    }, dependencies), 'resource-exhausted');
    expect(state.requesterCounts[exhaustedKey] ?? state.sellerCounts[exhaustedKey])
      .toBe(_scope === 'requester' ? requesterCount : sellerCount);
    expect(state.audits).toEqual([expect.objectContaining({ outcome: 'rate_limited' })]);
    expect(JSON.stringify(state.audits)).not.toContain('aming');
  });

  it('accepts the request immediately below both limits', async () => {
    const { state, dependencies } = harness({
      requesterCounts: { 'buyer-1:2026090403': 59 },
      sellerCounts: { 'seller-1:2026090403': 299 },
    });
    await handleGetSellerContact({ authUid: 'buyer-1', data: { listingId: 'listing-1' } }, dependencies);
    expect(state.requesterCounts['buyer-1:2026090403']).toBe(60);
    expect(state.sellerCounts['seller-1:2026090403']).toBe(300);
  });

  it('rejects malformed disclosure input before opening a transaction', async () => {
    const { dependencies } = harness();
    const runTransaction = vi.spyOn(dependencies, 'runTransaction');
    await expectCode(handleGetSellerContact({
      authUid: 'buyer-1', data: { listingId: '', sellerUid: 'seller-1' },
    }, dependencies), 'invalid-argument');
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it('writes a contact-free unavailable audit after an unexpected transaction failure', async () => {
    const { dependencies, externalAudits } = harness();
    dependencies.runTransaction = async () => { throw new Error('database unavailable'); };

    await expectCode(handleGetSellerContact({
      authUid: 'buyer-1', data: { listingId: 'listing-1' },
    }, dependencies), 'unavailable');
    expect(externalAudits).toEqual([{
      id: 'audit-1', requesterUid: 'buyer-1', listingId: 'listing-1',
      outcome: 'unavailable', createdAt: NOW,
    }]);
    expect(JSON.stringify(externalAudits)).not.toContain('contact');
  });
});
