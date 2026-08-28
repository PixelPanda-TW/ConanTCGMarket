import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebase = vi.hoisted(() => ({
  initializeApp: vi.fn(() => ({ type: 'app' })),
  getAuth: vi.fn(() => ({ type: 'auth' })),
  getFunctions: vi.fn(() => ({ type: 'functions' })),
  getStorage: vi.fn(() => ({ type: 'storage' })),
  getFirestore: vi.fn(() => ({ type: 'firestore' })),
  initializeFirestore: vi.fn(() => ({ type: 'firestore' })),
}));
const emulators = vi.hoisted(() => ({
  readFirebaseEmulatorEnv: vi.fn(),
  connectFirebaseAppEmulators: vi.fn(),
  connectFirestoreToEmulator: vi.fn(),
}));

vi.mock('firebase/app', () => ({ initializeApp: firebase.initializeApp }));
vi.mock('firebase/auth', () => ({ getAuth: firebase.getAuth }));
vi.mock('firebase/functions', () => ({ getFunctions: firebase.getFunctions }));
vi.mock('firebase/storage', () => ({ getStorage: firebase.getStorage }));
vi.mock('firebase/firestore', () => ({
  getFirestore: firebase.getFirestore,
  initializeFirestore: firebase.initializeFirestore,
}));
vi.mock('./config', () => ({
  firebaseConfig: {
    apiKey: 'demo-api-key',
    authDomain: 'demo-conan-tcg-e2e.firebaseapp.com',
    projectId: 'demo-conan-tcg-e2e',
    storageBucket: 'demo-conan-tcg-e2e.appspot.com',
    messagingSenderId: '000000000000',
    appId: '1:000000000000:web:e2e000000000000000000',
  },
}));
vi.mock('./emulators', () => emulators);

describe('Firebase client initialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    emulators.readFirebaseEmulatorEnv.mockImplementation(() => {
      throw new Error('Unsafe Firebase Emulator configuration.');
    });
  });

  it('validates Emulator configuration before constructing any service client', async () => {
    await expect(import('../../data/firestore/database'))
      .rejects.toThrow('Unsafe Firebase Emulator configuration.');

    expect(firebase.getAuth).not.toHaveBeenCalled();
    expect(firebase.getStorage).not.toHaveBeenCalled();
    expect(firebase.getFunctions).not.toHaveBeenCalled();
    expect(firebase.getFirestore).not.toHaveBeenCalled();
    expect(firebase.initializeFirestore).not.toHaveBeenCalled();
  });
});
