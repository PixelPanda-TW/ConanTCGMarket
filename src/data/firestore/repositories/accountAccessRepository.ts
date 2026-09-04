import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import type { AccountAccess } from '../../../domain/models';
import { auth } from '../../../lib/firebase/app';
import { accountAccessConverter } from '../converters';
import { firestoreDb } from '../database';
import { collections } from '../paths';

export function subscribeAccountAccess(
  uid: string,
  onValue: (access: AccountAccess | null) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  if (uid.trim().length === 0 || auth.currentUser?.uid !== uid) {
    throw new Error('Account access requires the authenticated account.');
  }

  const reference = doc(firestoreDb, collections.accountAccess, uid)
    .withConverter(accountAccessConverter);
  return onSnapshot(
    reference,
    (snapshot) => {
      try {
        onValue(snapshot.exists() ? snapshot.data() : null);
      } catch (error) {
        onError(error instanceof Error ? error : new Error('Account access is unavailable.'));
      }
    },
    onError,
  );
}
