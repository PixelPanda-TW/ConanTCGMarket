import {
  GoogleAuthProvider,
  getIdTokenResult,
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

export function onAuthUserChanged(
  callback: (user: AuthUser | null) => void,
  errorCallback?: (error: Error) => void,
) {
  return onAuthStateChanged(auth, (user) => {
    callback(user ? toAuthUser(user) : null);
  }, errorCallback);
}

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  await signInWithPopup(auth, provider);
}

export function signOutUser() {
  return signOut(auth);
}

export async function resolveAdminClaim(uid: string): Promise<boolean> {
  const currentUser = auth.currentUser;
  if (!currentUser || currentUser.uid !== uid) {
    throw new Error('Admin claim lookup requires the current authenticated identity.');
  }
  const token = await getIdTokenResult(currentUser, true);
  return token.claims.admin === true;
}
