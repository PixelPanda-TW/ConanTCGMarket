import { describe, expect, it } from 'vitest';
import { readFirebaseEmulatorEnv } from './emulators';

const enabled = {
  VITE_FIREBASE_USE_EMULATORS: 'true',
  VITE_FIREBASE_EMULATOR_HOST: '127.0.0.1',
  VITE_FIREBASE_AUTH_EMULATOR_PORT: '9099',
  VITE_FIREBASE_FIRESTORE_EMULATOR_PORT: '8080',
  VITE_FIREBASE_STORAGE_EMULATOR_PORT: '9199',
  VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT: '5001',
};

describe('Firebase Emulator configuration', () => {
  it('stays disabled unless explicitly true', () => {
    expect(readFirebaseEmulatorEnv({}, 'conantcgmarket')).toBeNull();
  });

  it.each([undefined, 'false'] as const)(
    'rejects %s Emulator enablement in E2E mode',
    (enabledValue) => {
      expect(() => readFirebaseEmulatorEnv(
        enabledValue === undefined ? {} : { VITE_FIREBASE_USE_EMULATORS: enabledValue },
        'demo-conan-tcg-e2e',
        'e2e',
      )).toThrow(/Emulator mode must be explicitly enabled/);
    },
  );

  it.each([
    '127.0.0.1', 'localhost', '192.168.1.10', '10.0.0.2',
    '172.16.0.1', '172.31.255.254', '100.91.185.105',
    '100.64.0.1', '100.127.255.254',
  ])('accepts fixed configuration on %s', (host) => {
    expect(readFirebaseEmulatorEnv({ ...enabled, VITE_FIREBASE_EMULATOR_HOST: host }, 'demo-conan-tcg-e2e')).toEqual({
      host,
      authPort: 9099,
      firestorePort: 8080,
      storagePort: 9199,
      functionsPort: 5001,
    });
  });

  it.each([
    [{ ...enabled }, 'conantcgmarket'],
    [{ ...enabled, VITE_FIREBASE_EMULATOR_HOST: '100.91.185.105' }, 'conantcgmarket'],
    [{ ...enabled, VITE_FIREBASE_EMULATOR_HOST: '::1' }, 'demo-conan-tcg-e2e'],
    [{ ...enabled, VITE_FIREBASE_AUTH_EMULATOR_PORT: 'invalid' }, 'demo-conan-tcg-e2e'],
  ])('rejects unsafe enabled configuration', (env, projectId) => {
    expect(() => readFirebaseEmulatorEnv(env, projectId)).toThrow(/Emulator configuration/);
  });

  it('trims the configured host', () => {
    expect(readFirebaseEmulatorEnv({
      ...enabled, VITE_FIREBASE_EMULATOR_HOST: ' 100.91.185.105 ',
    }, 'demo-conan-tcg-e2e')?.host).toBe('100.91.185.105');
  });

  it.each([
    undefined, true, '', ' ', '0.0.0.0', '8.8.8.8', 'example.com',
    '100.63.255.255', '100.128.0.1', '172.15.0.1', '172.32.0.1',
    '192.169.1.1', '192.168.1.256', '192.168.1', '192.168.01.1',
    'http://100.91.185.105', '100.91.185.105:9099',
  ])('rejects unsupported host %s', (host) => {
    expect(() => readFirebaseEmulatorEnv({
      ...enabled, VITE_FIREBASE_EMULATOR_HOST: host,
    }, 'demo-conan-tcg-e2e')).toThrow(/Emulator configuration/);
  });

  it.each([
    ['VITE_FIREBASE_AUTH_EMULATOR_PORT', '9098'],
    ['VITE_FIREBASE_FIRESTORE_EMULATOR_PORT', '8081'],
    ['VITE_FIREBASE_STORAGE_EMULATOR_PORT', '9200'],
    ['VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT', '5002'],
  ])('rejects an unexpected numeric %s', (key, value) => {
    expect(() => readFirebaseEmulatorEnv({ ...enabled, [key]: value }, 'demo-conan-tcg-e2e'))
      .toThrow(/Emulator configuration/);
  });
});
