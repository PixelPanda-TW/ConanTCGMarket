import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  doc: vi.fn(),
  connectFirestoreEmulator: vi.fn(),
  getDoc: vi.fn(),
  getFirestore: vi.fn(() => ({ type: 'firestore' })),
  setDoc: vi.fn(),
}));

const firebaseApp = vi.hoisted(() => ({
  firebaseApp: { name: 'test-app' },
  auth: { currentUser: { uid: 'seller-1' } },
  firebaseEmulatorConfig: null,
}));

vi.mock('firebase/firestore', () => firestore);
vi.mock('../../../lib/firebase/app', () => firebaseApp);

import { getSellerProfile, saveSellerProfile } from './sellerProfileRepository';
import { sellerProfileConverter } from '../converters';
import { collections } from '../paths';
import type { SellerProfile } from '../../../domain/models';

describe('seller profile repository', () => {
  const convertedDocument = { type: 'converted-seller-profile' };
  const withConverter = vi.fn(() => convertedDocument);

  const profile: SellerProfile = {
    uid: 'seller-1',
    displayName: '阿明',
    contactType: 'line',
    contactValue: 'aming',
    createdAt: new Date('2026-08-18T00:00:00.000Z'),
    updatedAt: new Date('2026-08-18T00:00:00.000Z'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    firestore.doc.mockReturnValue({ withConverter });
  });

  it('opens a seller profile document with the sellerProfiles collection and converter', async () => {
    firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => profile });

    await expect(getSellerProfile(profile.uid)).resolves.toEqual(profile);

    expect(firestore.doc).toHaveBeenCalledWith(
      expect.anything(),
      collections.sellerProfiles,
      profile.uid,
    );
    expect(withConverter).toHaveBeenCalledWith(sellerProfileConverter);
  });

  it('returns null when the seller profile document does not exist', async () => {
    firestore.getDoc.mockResolvedValue({ exists: () => false });

    await expect(getSellerProfile(profile.uid)).resolves.toBeNull();
  });

  it('saves a seller profile through its converted document reference', async () => {
    await saveSellerProfile(profile);

    expect(firestore.setDoc).toHaveBeenCalledWith(convertedDocument, profile);
    expect(firestore.doc).toHaveBeenCalledWith(
      expect.anything(),
      collections.sellerProfiles,
      profile.uid,
    );
    expect(withConverter).toHaveBeenCalledWith(sellerProfileConverter);
  });

  it('rejects reading a profile for a different authenticated seller', async () => {
    await expect(getSellerProfile('seller-2')).rejects.toThrow(
      'Seller profile access requires the authenticated seller.',
    );
    expect(firestore.getDoc).not.toHaveBeenCalled();
  });

  it('rejects saving a profile for a different authenticated seller', async () => {
    await expect(saveSellerProfile({ ...profile, uid: 'seller-2' })).rejects.toThrow(
      'Seller profile access requires the authenticated seller.',
    );
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });
});
