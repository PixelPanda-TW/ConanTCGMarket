import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';

const firebaseAuth = vi.hoisted(() => ({
  onAuthStateChanged: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  GoogleAuthProvider: vi.fn(),
  getIdTokenResult: vi.fn(),
}));

vi.mock('firebase/auth', () => firebaseAuth);
vi.mock('../../lib/firebase/app', () => ({ auth: { name: 'test-auth', currentUser: null } }));

import {
  onAuthUserChanged,
  resolveAdminClaim,
  signInWithGoogle,
  signOutUser,
} from './authService';

describe('auth service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firebaseAuth.GoogleAuthProvider.mockImplementation(function () {
      return { name: 'google-provider' };
    });
    firebaseAuth.signInWithPopup.mockResolvedValue(undefined);
    firebaseAuth.signOut.mockResolvedValue(undefined);
  });

  it('maps Firebase users and returns the unsubscribe function', () => {
    const unsubscribe = vi.fn();
    firebaseAuth.onAuthStateChanged.mockImplementation((_auth, callback) => {
      callback({ uid: 'user-1', displayName: 'Seller', photoURL: 'https://photo.test/user-1' } as User);
      return unsubscribe;
    });

    const callback = vi.fn();
    expect(onAuthUserChanged(callback)).toBe(unsubscribe);
    expect(callback).toHaveBeenCalledWith({
      uid: 'user-1',
      displayName: 'Seller',
      photoURL: 'https://photo.test/user-1',
    });
  });

  it('passes null to the callback when Firebase reports no user', () => {
    firebaseAuth.onAuthStateChanged.mockImplementation((_auth, callback) => {
      callback(null);
      return vi.fn();
    });

    const callback = vi.fn();
    onAuthUserChanged(callback);

    expect(callback).toHaveBeenCalledWith(null);
  });

  it('signs in with a Google provider', async () => {
    await signInWithGoogle();

    expect(firebaseAuth.signInWithPopup).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'test-auth' }),
      { name: 'google-provider' },
    );
  });

  it('signs out the current user', async () => {
    await signOutUser();

    expect(firebaseAuth.signOut).toHaveBeenCalledWith(expect.objectContaining({ name: 'test-auth' }));
  });

  it.each([
    [true, true],
    [false, false],
    ['true', false],
    [undefined, false],
  ])('accepts only an exact true admin claim %#', async (claim, expected) => {
    const { auth } = await import('../../lib/firebase/app');
    const firebaseUser = { uid: 'user-1' } as User;
    Object.assign(auth, { currentUser: firebaseUser });
    firebaseAuth.getIdTokenResult.mockResolvedValue({ claims: { admin: claim } });

    await expect(resolveAdminClaim('user-1')).resolves.toBe(expected);
    expect(firebaseAuth.getIdTokenResult).toHaveBeenCalledWith(firebaseUser, true);
  });

  it('rejects a stale UID before refreshing any token', async () => {
    const { auth } = await import('../../lib/firebase/app');
    Object.assign(auth, { currentUser: { uid: 'user-2' } });
    await expect(resolveAdminClaim('user-1')).rejects.toThrow('authenticated identity');
    expect(firebaseAuth.getIdTokenResult).not.toHaveBeenCalled();
  });
});
