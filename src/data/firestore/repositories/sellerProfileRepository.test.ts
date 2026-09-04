import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({ doc: vi.fn(), getDoc: vi.fn(), getFirestore: vi.fn(() => ({ type: 'firestore' })) }));
const functions = vi.hoisted(() => ({
  callableByName: new Map<string, ReturnType<typeof vi.fn>>(),
  httpsCallable: vi.fn((_client: unknown, name: string) => {
    return functions.callableByName.get(name) ?? vi.fn();
  }),
}));
const firebaseApp = vi.hoisted(() => ({
  firebaseApp: { name: 'test-app' }, auth: { currentUser: { uid: 'seller-1' } },
  firebaseEmulatorConfig: null, functionsClient: { type: 'functions' },
}));

vi.mock('firebase/firestore', () => firestore);
vi.mock('firebase/functions', () => functions);
vi.mock('../../../lib/firebase/app', () => firebaseApp);

import { getPublicSellerProfile, getSellerContact, getSellerProfile, saveSellerProfile } from './sellerProfileRepository';
import { publicSellerProfileConverter } from '../converters';
import { collections } from '../paths';
import type { SellerProfile } from '../../../domain/models';

describe('seller profile repository', () => {
  const convertedDocument = { type: 'converted-public-seller-profile' };
  const withConverter = vi.fn(() => convertedDocument);
  const profile: SellerProfile = {
    uid: 'seller-1', displayName: '阿明', contactType: 'line', contactValue: 'aming',
    createdAt: new Date('2026-08-18T00:00:00.000Z'), updatedAt: new Date('2026-08-18T01:00:00.000Z'),
  };
  const wireProfile = { ...profile, createdAt: profile.createdAt.valueOf(), updatedAt: profile.updatedAt.valueOf() };

  beforeEach(() => {
    vi.clearAllMocks();
    functions.callableByName.clear();
    for (const name of ['getOwnSellerProfile', 'saveSellerProfile', 'getSellerContact']) {
      functions.callableByName.set(name, vi.fn());
    }
    firestore.doc.mockReturnValue({ withConverter });
  });

  it('reads only a strict public seller profile directly from Firestore', async () => {
    const publicProfile = { uid: 'seller-1', displayName: '阿明', createdAt: profile.createdAt, updatedAt: profile.updatedAt };
    firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => publicProfile });
    await expect(getPublicSellerProfile('seller-1')).resolves.toEqual(publicProfile);
    expect(firestore.doc).toHaveBeenCalledWith(expect.anything(), collections.sellerProfiles, 'seller-1');
    expect(withConverter).toHaveBeenCalledWith(publicSellerProfileConverter);
    expect(functions.httpsCallable).not.toHaveBeenCalled();
  });

  it('returns null for a missing public profile', async () => {
    firestore.getDoc.mockResolvedValue({ exists: () => false });
    await expect(getPublicSellerProfile('seller-1')).resolves.toBeNull();
  });

  it('loads an own composite profile through the empty-payload callable', async () => {
    const callable = functions.callableByName.get('getOwnSellerProfile')!;
    callable.mockResolvedValue({ data: wireProfile });
    const operation = getSellerProfile('seller-1');
    await expect(operation).resolves.toEqual(profile);
    expect(callable).toHaveBeenCalledWith({});
    expect(firestore.getDoc).not.toHaveBeenCalled();
  });

  it('returns null from the own-profile callable', async () => {
    functions.callableByName.get('getOwnSellerProfile')!.mockResolvedValue({ data: null });
    const operation = getSellerProfile('seller-1');
    await expect(operation).resolves.toBeNull();
  });

  it('sends only editable fields and adopts the authoritative saved profile response', async () => {
    const callable = functions.callableByName.get('saveSellerProfile')!;
    callable.mockResolvedValue({ data: { ...wireProfile, updatedAt: new Date('2026-09-04T00:00:00Z').valueOf() } });
    const operation = saveSellerProfile(profile);
    await expect(operation).resolves.toEqual({ ...profile, updatedAt: new Date('2026-09-04T00:00:00Z') });
    expect(callable).toHaveBeenCalledWith({ displayName: '阿明', contactType: 'line', contactValue: 'aming' });
  });

  it('reveals contact by Listing ID only', async () => {
    const callable = functions.callableByName.get('getSellerContact')!;
    callable.mockResolvedValue({ data: { contactType: 'discord', contactValue: 'aming.name' } });
    const operation = getSellerContact(' listing-1 ');
    await expect(operation).resolves.toEqual({ contactType: 'discord', contactValue: 'aming.name' });
    expect(callable).toHaveBeenCalledWith({ listingId: 'listing-1' });
  });

  it.each([
    ['extra own field', { ...wireProfile, email: 'private@example.com' }],
    ['missing own field', { ...wireProfile, contactValue: undefined }],
    ['invalid own timestamp', { ...wireProfile, updatedAt: Number.NaN }],
    ['noncanonical own contact', { ...wireProfile, contactType: 'threads', contactValue: '@legacy' }],
  ])('rejects malformed callable own-profile data: %s', async (_name, data) => {
    functions.callableByName.get('getOwnSellerProfile')!.mockResolvedValue({ data });
    const operation = getSellerProfile('seller-1');
    await expect(operation).rejects.toThrow('invalid seller profile response');
  });

  it.each([
    ['extra contact field', { contactType: 'line', contactValue: 'aming', uid: 'seller-1' }],
    ['missing contact value', { contactType: 'line' }],
    ['unsupported contact type', { contactType: 'email', contactValue: 'a@example.com' }],
    ['noncanonical contact', { contactType: 'facebook', contactValue: 'https://facebook.com/groups/conan' }],
  ])('rejects malformed disclosure data: %s', async (_name, data) => {
    functions.callableByName.get('getSellerContact')!.mockResolvedValue({ data });
    const operation = getSellerContact('listing-1');
    await expect(operation).rejects.toThrow('invalid seller contact response');
  });

  it('rejects cross-account own reads and writes before opening a callable', async () => {
    await expect(getSellerProfile('seller-2')).rejects.toThrow('authenticated seller');
    await expect(saveSellerProfile({ ...profile, uid: 'seller-2' })).rejects.toThrow('authenticated seller');
    expect(functions.httpsCallable).not.toHaveBeenCalled();
  });

  it.each(['', '   ', 'x'.repeat(129)])('rejects invalid Listing ID %j before opening a callable', async (id) => {
    await expect(getSellerContact(id)).rejects.toThrow('valid Listing ID');
    expect(functions.httpsCallable).not.toHaveBeenCalled();
  });
});
