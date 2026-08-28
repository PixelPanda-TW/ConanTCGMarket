import { connectAuthEmulator, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, type Firestore } from 'firebase/firestore';
import { connectFunctionsEmulator, type Functions } from 'firebase/functions';
import { connectStorageEmulator, type FirebaseStorage } from 'firebase/storage';

export interface FirebaseEmulatorConfig {
  host: '127.0.0.1' | 'localhost';
  authPort: number;
  firestorePort: number;
  storagePort: number;
  functionsPort: number;
}

const loopbackHosts = new Set(['127.0.0.1', 'localhost']);

function port(env: Record<string, string | boolean | undefined>, key: string, expected: number): number {
  const value = Number(env[key]);

  if (!Number.isInteger(value) || value !== expected) {
    throw new Error(`Unsafe Firebase Emulator configuration: ${key}`);
  }

  return value;
}

export function readFirebaseEmulatorEnv(
  env: Record<string, string | boolean | undefined>,
  projectId: string,
  mode?: string,
): FirebaseEmulatorConfig | null {
  if (env.VITE_FIREBASE_USE_EMULATORS !== 'true') {
    if (mode === 'e2e') {
      throw new Error('Unsafe Firebase Emulator configuration: Emulator mode must be explicitly enabled in E2E mode.');
    }
    return null;
  }

  const host = env.VITE_FIREBASE_EMULATOR_HOST;

  if (!projectId.startsWith('demo-') || typeof host !== 'string' || !loopbackHosts.has(host)) {
    throw new Error('Unsafe Firebase Emulator configuration: demo project and loopback host required.');
  }

  return {
    host: host as FirebaseEmulatorConfig['host'],
    authPort: port(env, 'VITE_FIREBASE_AUTH_EMULATOR_PORT', 9099),
    firestorePort: port(env, 'VITE_FIREBASE_FIRESTORE_EMULATOR_PORT', 8080),
    storagePort: port(env, 'VITE_FIREBASE_STORAGE_EMULATOR_PORT', 9199),
    functionsPort: port(env, 'VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT', 5001),
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
