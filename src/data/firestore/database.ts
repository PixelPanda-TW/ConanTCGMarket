import { getFirestore } from 'firebase/firestore';
import { firebaseApp, firebaseEmulatorConfig } from '../../lib/firebase/app';
import { connectFirestoreToEmulator } from '../../lib/firebase/emulators';

export const firestoreDb = getFirestore(firebaseApp);

if (firebaseEmulatorConfig) {
  connectFirestoreToEmulator(firebaseEmulatorConfig, firestoreDb);
}
