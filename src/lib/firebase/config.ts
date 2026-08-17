export interface FirebaseEnv {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

const requiredEnvKeys = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
] as const;

type FirebaseEnvKey = (typeof requiredEnvKeys)[number];

const firebaseConfigKeyByEnvKey: Record<FirebaseEnvKey, keyof FirebaseEnv> = {
  VITE_FIREBASE_API_KEY: 'apiKey',
  VITE_FIREBASE_AUTH_DOMAIN: 'authDomain',
  VITE_FIREBASE_PROJECT_ID: 'projectId',
  VITE_FIREBASE_STORAGE_BUCKET: 'storageBucket',
  VITE_FIREBASE_MESSAGING_SENDER_ID: 'messagingSenderId',
  VITE_FIREBASE_APP_ID: 'appId',
};

export function readFirebaseEnv(env: Record<string, string | boolean | undefined>): FirebaseEnv {
  return requiredEnvKeys.reduce((config, envKey) => {
    const value = env[envKey];

    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`Missing Firebase environment variable: ${envKey}`);
    }

    return {
      ...config,
      [firebaseConfigKeyByEnvKey[envKey]]: value,
    };
  }, {} as FirebaseEnv);
}

export const firebaseConfig = readFirebaseEnv(import.meta.env);
