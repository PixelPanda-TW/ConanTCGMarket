# Firebase Project Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the React app to Firebase and add Google sign-in state while keeping the marketplace publicly browsable.

**Architecture:** Add a small Firebase boundary under `src/lib/firebase/` and an auth feature boundary under `src/features/auth/`. UI consumes auth through a React provider hook, so later seller-only routes can rely on UID without importing Firebase directly.

**Tech Stack:** React, TypeScript, Vite, Firebase Web SDK, Vitest.

## Global Constraints

- Frontend is React, TypeScript, and Vite.
- Deployment target is GitHub Pages at `https://<github-username>.github.io/<project-name>/`.
- Vite base path remains `/ConanTCGMarket/`.
- Buyers do not need accounts to browse, search, inspect listings, or use filters.
- Seller-only actions require Firebase Authentication with Google Sign-In.
- Google email is not automatically public and is not used as the default contact method.
- App code must not commit real Firebase secrets; Firebase config comes from `VITE_FIREBASE_*` environment variables.

---

## File Structure

- `src/lib/firebase/config.ts`: Reads and validates Vite Firebase environment variables.
- `src/lib/firebase/app.ts`: Initializes and exports the Firebase app instance.
- `src/features/auth/authService.ts`: Wraps Firebase Auth calls: sign in, sign out, and auth state subscription.
- `src/features/auth/AuthProvider.tsx`: React context provider and `useAuth()` hook.
- `src/features/auth/AuthStatus.tsx`: Small UI component for signed-out, loading, and signed-in states.
- `src/main.tsx`: Wraps `<App />` in `<AuthProvider />`.
- `src/App.tsx`: Renders auth status without blocking marketplace browsing.
- `src/styles.css`: Adds styles for the auth status area.
- `.env.example`: Documents required Firebase env variable names.
- `src/lib/firebase/config.test.ts`: Tests config parsing without connecting to Firebase.

## Task 1: Firebase Config Boundary

**Files:**
- Create: `src/lib/firebase/config.ts`
- Test: `src/lib/firebase/config.test.ts`
- Modify: `.env.example`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `FirebaseEnv` interface with `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, and `appId`.
- Produces: `readFirebaseEnv(env: Record<string, string | boolean | undefined>): FirebaseEnv`.
- Produces: `firebaseConfig: FirebaseEnv`.

- [ ] **Step 1: Add Firebase SDK dependency**

Run:

```bash
npm install firebase
```

Expected: `package.json` contains `"firebase"` in dependencies and `package-lock.json` updates.

- [ ] **Step 2: Write the failing config test**

Create `src/lib/firebase/config.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the config test and verify it fails**

Run:

```bash
npm test -- src/lib/firebase/config.test.ts
```

Expected: FAIL because `src/lib/firebase/config.ts` does not exist.

- [ ] **Step 4: Implement Firebase config parsing**

Create `src/lib/firebase/config.ts`:

```ts
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
```

- [ ] **Step 5: Document required environment variables**

Create or update `.env.example`:

```bash
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

- [ ] **Step 6: Run tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .env.example src/lib/firebase/config.ts src/lib/firebase/config.test.ts
git commit -m "Add Firebase config boundary"
```

## Task 2: Firebase App and Auth Service

**Files:**
- Create: `src/lib/firebase/app.ts`
- Create: `src/features/auth/authService.ts`

**Interfaces:**
- Consumes: `firebaseConfig` from `src/lib/firebase/config.ts`.
- Produces: `firebaseApp`.
- Produces: `auth`.
- Produces: `AuthUser` interface with `uid`, `displayName`, and `photoURL`.
- Produces: `onAuthUserChanged(callback: (user: AuthUser | null) => void): () => void`.
- Produces: `signInWithGoogle(): Promise<void>`.
- Produces: `signOutUser(): Promise<void>`.

- [ ] **Step 1: Create Firebase app initializer**

Create `src/lib/firebase/app.ts`:

```ts
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { firebaseConfig } from './config';

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
```

- [ ] **Step 2: Create Auth service wrapper**

Create `src/features/auth/authService.ts`:

```ts
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { auth } from '../../lib/firebase/app';

export interface AuthUser {
  uid: string;
  displayName: string | null;
  photoURL: string | null;
}

function toAuthUser(user: User): AuthUser {
  return {
    uid: user.uid,
    displayName: user.displayName,
    photoURL: user.photoURL,
  };
}

export function onAuthUserChanged(callback: (user: AuthUser | null) => void) {
  return onAuthStateChanged(auth, (user) => {
    callback(user ? toAuthUser(user) : null);
  });
}

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  await signInWithPopup(auth, provider);
}

export function signOutUser() {
  return signOut(auth);
}
```

- [ ] **Step 3: Run TypeScript build**

Run:

```bash
npm run build
```

Expected: build fails until `.env` exists locally, or passes if local env variables are present. If it fails from missing Firebase variables, create a local `.env` from `.env.example` with development Firebase project values before retrying.

- [ ] **Step 4: Commit**

```bash
git add src/lib/firebase/app.ts src/features/auth/authService.ts
git commit -m "Add Firebase auth service"
```

## Task 3: Auth Provider and UI Integration

**Files:**
- Create: `src/features/auth/AuthProvider.tsx`
- Create: `src/features/auth/AuthStatus.tsx`
- Modify: `src/main.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `AuthUser`, `onAuthUserChanged`, `signInWithGoogle`, and `signOutUser` from `authService.ts`.
- Produces: `AuthState` type with `user`, `isLoading`, `error`, `signIn`, and `signOut`.
- Produces: `AuthProvider({ children }: { children: ReactNode })`.
- Produces: `useAuth(): AuthState`.
- Produces: `AuthStatus()` component.

- [ ] **Step 1: Create Auth provider**

Create `src/features/auth/AuthProvider.tsx`:

```tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  type AuthUser,
  onAuthUserChanged,
  signInWithGoogle,
  signOutUser,
} from './authService';

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return onAuthUserChanged((nextUser) => {
      setUser(nextUser);
      setIsLoading(false);
    });
  }, []);

  const signIn = useCallback(async () => {
    setError(null);

    try {
      await signInWithGoogle();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Google sign-in failed.');
    }
  }, []);

  const signOut = useCallback(async () => {
    setError(null);
    await signOutUser();
  }, []);

  const value = useMemo(
    () => ({ user, isLoading, error, signIn, signOut }),
    [error, isLoading, signIn, signOut, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);

  if (!value) {
    throw new Error('useAuth must be used inside AuthProvider.');
  }

  return value;
}
```

- [ ] **Step 2: Wrap the app in AuthProvider**

Modify `src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App';
import { AuthProvider } from './features/auth/AuthProvider';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
```

- [ ] **Step 3: Add auth status UI**

Create `src/features/auth/AuthStatus.tsx`:

```tsx
import { useAuth } from './AuthProvider';

export function AuthStatus() {
  const { error, isLoading, signIn, signOut, user } = useAuth();

  return (
    <div className="auth-status" aria-live="polite">
      {isLoading ? (
        <span>登入狀態確認中</span>
      ) : user ? (
        <>
          <span>賣家登入中：{user.displayName ?? user.uid}</span>
          <button type="button" onClick={signOut}>
            登出
          </button>
        </>
      ) : (
        <>
          <span>買家可直接瀏覽；賣家上架需登入</span>
          <button type="button" onClick={signIn}>
            使用 Google 登入
          </button>
        </>
      )}
      {error && <p className="auth-error">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Render auth status in the app**

Modify `src/App.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { AuthStatus } from './features/auth/AuthStatus';
import { filterListings } from './listingFilters';
```

Add `<AuthStatus />` as the first child inside `.marketplace`.

- [ ] **Step 5: Style auth status**

Add to `src/styles.css`:

```css
.auth-status {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  border: 1px solid #d0d7de;
  border-radius: 8px;
  background: #fff;
  padding: 12px 14px;
}

.auth-status button {
  min-height: 36px;
  border: 0;
  border-radius: 8px;
  background: #24292f;
  color: #fff;
  padding: 0 14px;
  font-weight: 700;
  cursor: pointer;
}

.auth-error {
  flex-basis: 100%;
  margin: 0;
  color: #cf222e;
}
```

- [ ] **Step 6: Run verification**

Run:

```bash
npm test
npm run build
```

Expected: tests pass and production build succeeds when local Firebase env variables are present.

- [ ] **Step 7: Commit**

```bash
git add src/main.tsx src/App.tsx src/styles.css src/features/auth/AuthProvider.tsx src/features/auth/AuthStatus.tsx
git commit -m "Add auth provider and sign-in UI"
```

## Task 4: Local and Deployment Setup Notes

**Files:**
- Create: `docs/firebase-setup.md`
- Modify: `docs/milestones.md`

**Interfaces:**
- Consumes: `.env.example` variable names.
- Produces: Firebase setup instructions for local development and GitHub Pages Actions secrets.

- [ ] **Step 1: Write setup documentation**

Create `docs/firebase-setup.md`:

```md
# Firebase Setup

## Local Development

Create `.env` from `.env.example` and fill it with the Firebase web app config from Firebase Console.

Required variables:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

## Firebase Console

Enable Authentication with Google as a sign-in provider.

Add these authorized domains for Authentication:

- `localhost`
- `127.0.0.1`
- `PixelPanda-TW.github.io`

## GitHub Pages Deployment

Add the same values as repository variables or secrets before deploying with GitHub Actions. The workflow must expose them to the Vite build as `VITE_FIREBASE_*` values.
```

- [ ] **Step 2: Mark Milestone 1 implementation notes**

Modify the Milestone 1 section in `docs/milestones.md` to mention `docs/firebase-setup.md` as the setup document.

- [ ] **Step 3: Run documentation check**

Run:

```bash
rg -n "T[B]D|PLACEHOLD[E]R|\\?\\?" docs/firebase-setup.md docs/milestones.md
```

Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add docs/firebase-setup.md docs/milestones.md
git commit -m "Document Firebase setup"
```

## Task 5: GitHub Pages Workflow Environment Variables

**Files:**
- Modify: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: GitHub Actions variables or secrets named `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, and `VITE_FIREBASE_APP_ID`.
- Produces: Vite build environment variables in the `Build` step.

- [ ] **Step 1: Update GitHub Actions build env**

Modify the `Build` step in `.github/workflows/deploy.yml`:

```yaml
      - name: Build
        run: npm run build
        env:
          VITE_FIREBASE_API_KEY: ${{ vars.VITE_FIREBASE_API_KEY }}
          VITE_FIREBASE_AUTH_DOMAIN: ${{ vars.VITE_FIREBASE_AUTH_DOMAIN }}
          VITE_FIREBASE_PROJECT_ID: ${{ vars.VITE_FIREBASE_PROJECT_ID }}
          VITE_FIREBASE_STORAGE_BUCKET: ${{ vars.VITE_FIREBASE_STORAGE_BUCKET }}
          VITE_FIREBASE_MESSAGING_SENDER_ID: ${{ vars.VITE_FIREBASE_MESSAGING_SENDER_ID }}
          VITE_FIREBASE_APP_ID: ${{ vars.VITE_FIREBASE_APP_ID }}
```

- [ ] **Step 2: Run build locally**

Run:

```bash
npm run build
```

Expected: succeeds when `.env` contains all required variables. If `.env` is not configured yet, this fails with a missing Firebase variable; create `.env` before retrying.

- [ ] **Step 3: Commit and push**

```bash
git add .github/workflows/deploy.yml
git commit -m "Pass Firebase config to Pages build"
git push
```

## Self-Review

### Spec Coverage

- Firebase app initialization: Task 1 and Task 2.
- Google sign-in and sign-out: Task 2 and Task 3.
- Auth state provider: Task 3.
- Current user UID for seller-only flows: Task 2 and Task 3 expose `AuthUser.uid`.
- Guest browsing remains available: Task 3 renders auth status without gating `<App />` marketplace content.
- Google email is not public: Task 2 maps UID, display name, and photo URL only.
- GitHub Pages deployment support: Task 5 passes Vite Firebase variables during the Actions build.

### Placeholder Scan

No placeholder markers are intentionally present in this plan.

### Type Consistency

The provider consumes the exact `AuthUser`, `onAuthUserChanged`, `signInWithGoogle`, and `signOutUser` exports defined by the auth service. The Firebase app initializer consumes the exact `firebaseConfig` export defined by config parsing.
