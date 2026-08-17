import { describe, expect, it } from 'vitest';
import { readFirebaseEnv } from './config';

describe('readFirebaseEnv', () => {
  it('maps Vite Firebase environment variables into Firebase config keys', () => {
    const config = readFirebaseEnv({
      VITE_FIREBASE_API_KEY: 'api-key',
      VITE_FIREBASE_AUTH_DOMAIN: 'project.firebaseapp.com',
      VITE_FIREBASE_PROJECT_ID: 'project-id',
      VITE_FIREBASE_STORAGE_BUCKET: 'project.appspot.com',
      VITE_FIREBASE_MESSAGING_SENDER_ID: 'sender-id',
      VITE_FIREBASE_APP_ID: 'app-id',
    });

    expect(config).toEqual({
      apiKey: 'api-key',
      authDomain: 'project.firebaseapp.com',
      projectId: 'project-id',
      storageBucket: 'project.appspot.com',
      messagingSenderId: 'sender-id',
      appId: 'app-id',
    });
  });

  it('throws a clear error when a required Firebase variable is missing', () => {
    expect(() =>
      readFirebaseEnv({
        VITE_FIREBASE_API_KEY: 'api-key',
        VITE_FIREBASE_AUTH_DOMAIN: 'project.firebaseapp.com',
        VITE_FIREBASE_PROJECT_ID: 'project-id',
        VITE_FIREBASE_STORAGE_BUCKET: 'project.appspot.com',
        VITE_FIREBASE_MESSAGING_SENDER_ID: 'sender-id',
      }),
    ).toThrow('Missing Firebase environment variable: VITE_FIREBASE_APP_ID');
  });
});
