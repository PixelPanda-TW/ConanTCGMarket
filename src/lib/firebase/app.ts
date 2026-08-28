import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFunctions } from 'firebase/functions';
import { getStorage } from 'firebase/storage';
import { firebaseConfig } from './config';
import { connectFirebaseAppEmulators, readFirebaseEmulatorEnv } from './emulators';

export const firebaseEmulatorConfig = readFirebaseEmulatorEnv(
  import.meta.env,
  firebaseConfig.projectId,
  import.meta.env.MODE,
);
export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const storage = getStorage(firebaseApp);
export const functionsClient = getFunctions(firebaseApp);

if (firebaseEmulatorConfig) {
  connectFirebaseAppEmulators(firebaseEmulatorConfig, { auth, storage, functions: functionsClient });
}
