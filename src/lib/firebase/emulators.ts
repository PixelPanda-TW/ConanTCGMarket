import { connectAuthEmulator, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, type Firestore } from 'firebase/firestore';
import { connectFunctionsEmulator, type Functions } from 'firebase/functions';
import { connectStorageEmulator, type FirebaseStorage } from 'firebase/storage';

export interface FirebaseEmulatorConfig {
  host: '127.0.0.1' | 'localhost' | '::1';
  authPort: number;
  firestorePort: number;
  storagePort: number;
  functionsPort: number;
}

const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);

function port(env: Record<string, string | boolean | undefined>, key: string): number {
  const value = Number(env[key]);

  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`Unsafe Firebase Emulator configuration: ${key}`);
  }

  return value;
}

export function readFirebaseEmulatorEnv(
  env: Record<string, string | boolean | undefined>,
  projectId: string,
): FirebaseEmulatorConfig | null {
  if (env.VITE_FIREBASE_USE_EMULATORS !== 'true') return null;

  const host = env.VITE_FIREBASE_EMULATOR_HOST;

  if (!projectId.startsWith('demo-') || typeof host !== 'string' || !loopbackHosts.has(host)) {
    throw new Error('Unsafe Firebase Emulator configuration: demo project and loopback host required.');
  }

  return {
    host: host as FirebaseEmulatorConfig['host'],
    authPort: port(env, 'VITE_FIREBASE_AUTH_EMULATOR_PORT'),
    firestorePort: port(env, 'VITE_FIREBASE_FIRESTORE_EMULATOR_PORT'),
    storagePort: port(env, 'VITE_FIREBASE_STORAGE_EMULATOR_PORT'),
    functionsPort: port(env, 'VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT'),
  };
}

export function connectFirebaseAppEmulators(
  config: FirebaseEmulatorConfig,
  services: { auth: Auth; storage: FirebaseStorage; functions: Functions },
): void {
  connectAuthEmulator(services.auth, `http://${config.host}:${config.authPort}`, { disableWarnings: true });
  connectStorageEmulator(services.storage, config.host, config.storagePort);
  connectFunctionsEmulator(services.functions, config.host, config.functionsPort);
}

export function connectFirestoreToEmulator(config: FirebaseEmulatorConfig, firestore: Firestore): void {
  connectFirestoreEmulator(firestore, config.host, config.firestorePort);
}
