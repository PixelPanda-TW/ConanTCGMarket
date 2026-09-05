import { connectAuthEmulator, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, type Firestore } from 'firebase/firestore';
import { connectFunctionsEmulator, type Functions } from 'firebase/functions';
import { connectStorageEmulator, type FirebaseStorage } from 'firebase/storage';

export interface FirebaseEmulatorConfig {
  host: string;
  authPort: number;
  firestorePort: number;
  storagePort: number;
  functionsPort: number;
}

const loopbackHosts = new Set(['127.0.0.1', 'localhost']);

function isEmulatorHost(host: string): boolean {
  if (loopbackHosts.has(host)) return true;

  const octets = host.split('.');
  if (octets.length !== 4 || octets.some((value) =>
    !/^(0|[1-9]\d{0,2})$/.test(value) || Number(value) > 255)) {
    return false;
  }

  const [first, second] = octets.map(Number);
  // Private LAN addresses and the CGNAT range used by Tailscale.
  return first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 100 && second >= 64 && second <= 127);
}

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

  const configuredHost = env.VITE_FIREBASE_EMULATOR_HOST;
  const host = typeof configuredHost === 'string' ? configuredHost.trim() : '';

  if (!projectId.startsWith('demo-') || !isEmulatorHost(host)) {
    throw new Error('Unsafe Firebase Emulator configuration: demo project and loopback, private IPv4, or Tailscale IPv4 host required.');
  }

  return {
    host,
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
