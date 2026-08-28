import { getFirestore, initializeFirestore } from 'firebase/firestore';
import { firebaseApp, firebaseEmulatorConfig } from '../../lib/firebase/app';
import { connectFirestoreToEmulator } from '../../lib/firebase/emulators';

export const firestoreDb = firebaseEmulatorConfig
  ? initializeFirestore(firebaseApp, { experimentalForceLongPolling: true })
  : getFirestore(firebaseApp);

if (firebaseEmulatorConfig) {
  connectFirestoreToEmulator(firebaseEmulatorConfig, firestoreDb);
}
