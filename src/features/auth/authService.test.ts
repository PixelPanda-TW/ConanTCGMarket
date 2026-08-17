import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';

const firebaseAuth = vi.hoisted(() => ({
  onAuthStateChanged: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  GoogleAuthProvider: vi.fn(),
}));

vi.mock('firebase/auth', () => firebaseAuth);
vi.mock('../../lib/firebase/app', () => ({ auth: { name: 'test-auth' } }));

import {
  onAuthUserChanged,
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
      { name: 'test-auth' },
      { name: 'google-provider' },
    );
  });

  it('signs out the current user', async () => {
    await signOutUser();

    expect(firebaseAuth.signOut).toHaveBeenCalledWith({ name: 'test-auth' });
  });
});
