import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { auth } from '../../lib/firebase/app';

export interface AuthUser {
  uid: string;
  displayName: string | null;
  photoURL: string | null;
}

function toAuthUser(user: User): AuthUser {
  return {
    uid: user.uid,
    displayName: user.displayName,
    photoURL: user.photoURL,
  };
}

export function onAuthUserChanged(callback: (user: AuthUser | null) => void) {
  return onAuthStateChanged(auth, (user) => {
    callback(user ? toAuthUser(user) : null);
  });
}

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  await signInWithPopup(auth, provider);
}

export function signOutUser() {
  return signOut(auth);
}
