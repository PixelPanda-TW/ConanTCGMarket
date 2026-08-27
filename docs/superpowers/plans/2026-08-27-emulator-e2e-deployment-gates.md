# Emulator Integration / E2E Deployment Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic Firebase Emulator integration tests for every current user operation and make them mandatory before each GitHub Pages deployment.

**Architecture:** The frontend receives an explicit fail-closed Emulator mode, while a Playwright support layer owns Emulator reset, seed, inspection, and mock Google popup login. Chromium runs complete user journeys, WebKit repeats the core mobile flows and every form, existing Functions and Rules suites cover backend boundaries, and one layered GitHub Actions workflow gates production build/deploy before a read-only smoke test.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Firebase Web/Admin SDKs, Firebase Local Emulator Suite, Firebase Functions v2, Playwright Chromium/WebKit, GitHub Actions, GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-08-27-emulator-e2e-deployment-gates-design.md`

## Global Constraints

- CI must use project ID `demo-conan-tcg-e2e` and loopback Emulator hosts only; it must never receive production Firebase or Gmail credentials.
- Auth uses the existing `使用 Google 登入` button and `signInWithPopup`; tests interact with the Auth Emulator popup and add no login backdoor.
- Emulator ports are Auth `9099`, Firestore `8080`, Storage `9199`, and Functions `5001`.
- Chromium desktop runs the complete E2E suite; WebKit uses an iPhone viewport for core flows and every form.
- Playwright uses one worker, local retries `0`, CI retries `1`, `failOnFlakyTests: true`, a 30-second test timeout, and a 20-minute E2E job timeout.
- Fixed sleeps are prohibited; UI waits use web-first assertions and backend waits use bounded polling.
- Daily digest tests use the existing injected fake Gmail boundary and send no real email.
- Pull requests run `quality`, `rules`, and `e2e` but never deploy; `main` reruns all gates, deploys only after success, then runs read-only smoke.
- Smoke failure marks the workflow red and uploads evidence but does not roll back or write production data.
- Failure/flaky artifacts include trace, screenshot, video, HTML report, and Emulator logs retained for 14 days.
- `TODO.md` is a local working tracker only. Do not stage or commit it.

## File Structure

### Runtime and toolchain

- `.env.e2e`: tracked non-secret demo Firebase values and explicit loopback Emulator settings.
- `src/lib/firebase/emulators.ts`: pure validation plus SDK connector functions for explicit Emulator mode.
- `src/lib/firebase/emulators.test.ts`: fail-closed configuration unit tests.
- `src/lib/firebase/app.ts`: connect Auth, Storage, and Functions before first use.
- `src/data/firestore/database.ts`: connect Firestore before first use.
- `src/vite-env.d.ts`: type the E2E environment keys.
- `firebase.json`: declare Auth and Functions Emulators in addition to Firestore and Storage.
- `package.json`, `package-lock.json`, `functions/package-lock.json`: deterministic commands and dependencies.
- `.gitignore`: ignore Playwright reports/results and all Emulator debug logs.

### Test harness and browser projects

- `e2e/support/emulator-state.ts`: assert safety, reset Auth/Firestore/Storage, seed scenario documents/files, and inspect backend state.
- `e2e/support/auth.ts`: operate the Auth Emulator Google popup and return the created deterministic test identity.
- `e2e/support/fixtures.ts`: shared cards, profiles, listings, and fixture builders.
- `e2e/support/test.ts`: Playwright fixture that resets Emulator state before and after each test.
- `e2e/fixtures/card-front.png`, `e2e/fixtures/card-back.png`: tiny valid image uploads.
- `playwright.config.ts`: Chromium desktop and WebKit iPhone projects plus local Vite server.
- `playwright.smoke.config.ts`: isolated Chromium-only read-only production project.
- `scripts/run-smoke.mjs`: parse the documented `--base-url` option and launch smoke safely.

### User-operation specifications

- `e2e/public-marketplace.spec.ts`: welcome notice, footer attribution, public market, filters, details, and empty/error/loading states.
- `e2e/card-master.spec.ts`: standalone Card Master search/select/clear and state coverage.
- `e2e/auth-profile.spec.ts`: mock Google sign-in/out and Profile create/edit/reload.
- `e2e/listing-lifecycle.spec.ts`: create, validation, upload, trigger, edit, replace images, and delete.
- `e2e/subscriptions.spec.ts`: sign-in guidance, subscribe, coverage, email preference, management, and removal.
- `e2e/sales-authorization.spec.ts`: Dashboard, partial/sold-out sales, oversell, owner restrictions, and private-data denial.
- `e2e/mvp-journey.spec.ts`: one cross-module acceptance journey.
- `e2e/mobile-forms.spec.ts`: WebKit iPhone core navigation and every form interaction.
- `e2e/smoke.spec.ts`: post-deploy read-only routing/assets/configuration smoke.

### CI contracts and documentation

- `scripts/package-contract.test.mjs`: deterministic script/dependency/lockfile contract.
- `scripts/e2e-contract.test.mjs`: project, retry, worker, artifact, timeout, and no-fixed-sleep contract.
- `scripts/workflow-contract.test.mjs`: event/job/needs/permissions/artifact/smoke contract.
- `.github/workflows/deploy.yml`: five-job quality/rules/e2e/deploy/smoke workflow.
- `docs/integration-testing.md`: local commands, safety model, troubleshooting, artifacts, branch protection, and staging triggers.

## Coverage Traceability

| Current user operation | Primary test deliverable |
| --- | --- |
| Welcome acknowledgement and attribution/footer links | `public-marketplace.spec.ts`, `smoke.spec.ts` |
| Public Card Master loading/search/select/clear/empty/error | `card-master.spec.ts` |
| Marketplace metadata/ID/service filters, empty/error/loading, detail navigation | `public-marketplace.spec.ts` |
| Google sign-in, authenticated navigation, sign-out | `auth-profile.spec.ts` |
| Profile create/edit/validation/reload and signed-out state | `auth-profile.spec.ts`, `mobile-forms.spec.ts` |
| Sell guidance, metadata validation, all fields/fees/note/images, create success | `listing-lifecycle.spec.ts`, `mobile-forms.spec.ts` |
| Listing detail/images/seller contact/conditions/owner management link | `public-marketplace.spec.ts`, `listing-lifecycle.spec.ts` |
| Listing edit/inventory constraint/image replacement/delete cancel+confirm | `listing-lifecycle.spec.ts`, `mobile-forms.spec.ts` |
| Subscribe guidance/confirmation/coverage/toggle/manage/remove | `subscriptions.spec.ts`, `mobile-forms.spec.ts` |
| Dashboard active/sold-out sections, summary, sale cancel/validate/partial/sold-out | `sales-authorization.spec.ts`, `mobile-forms.spec.ts` |
| High-risk cross-user/public access denial | `sales-authorization.spec.ts`, `firebaseRules.test.ts` |
| Listing-create Functions trigger | `listing-lifecycle.spec.ts` |
| Daily email matching/content/no-match without delivery | existing `functions/src/dailyDigest.test.ts`, enforced by `test:quality` |
| Complete composed MVP journey | `mvp-journey.spec.ts` |
| Deployed public entry/assets/routes/config | `smoke.spec.ts` |

---

### Task 1: Pin the test toolchain and command contract

**Files:**
- Create: `scripts/package-contract.test.mjs`
- Create: `functions/package-lock.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`

**Interfaces:**
- Produces scripts `test:scripts`, `build:e2e`, `test:quality`, `test:e2e`, `test:e2e:chromium`, `test:e2e:webkit`, and `test:smoke` used by all later tasks and CI.
- Produces locally pinned `firebase` and `playwright` CLIs through root `node_modules/.bin`.

- [ ] **Step 1: Write the failing package contract test**

```js
// scripts/package-contract.test.mjs
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const root = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('pins local E2E tools and exposes the approved commands', async () => {
  assert.ok(root.devDependencies['@playwright/test']);
  assert.ok(root.devDependencies['firebase-tools']);
  for (const script of [
    'test:scripts', 'build:e2e', 'test:quality', 'test:e2e',
    'test:e2e:chromium', 'test:e2e:webkit', 'test:smoke',
  ]) assert.equal(typeof root.scripts[script], 'string', `missing ${script}`);
  await access(new URL('../functions/package-lock.json', import.meta.url));
});
```

- [ ] **Step 2: Run the contract and verify it fails before dependencies/scripts exist**

Run: `node --test scripts/package-contract.test.mjs`

Expected: FAIL because `@playwright/test`, `firebase-tools`, scripts, and `functions/package-lock.json` do not yet exist.

- [ ] **Step 3: Install local tooling and create the Functions lockfile**

Run:

```bash
npm install --save-dev @playwright/test firebase-tools
npm --prefix functions install --package-lock-only
```

Then add these exact script responsibilities to `package.json`:

```json
{
  "test:scripts": "node --test scripts/*.test.mjs",
  "build:e2e": "tsc -b && vite build --mode e2e",
  "test:quality": "npm test && npm run test:scripts && npm run test:functions && npm --prefix functions run lint && npm run build:functions && npm run build:e2e",
  "test:e2e": "npm run build:functions && firebase emulators:exec --project demo-conan-tcg-e2e --only auth,firestore,storage,functions \"playwright test --config playwright.config.ts\"",
  "test:e2e:chromium": "npm run build:functions && firebase emulators:exec --project demo-conan-tcg-e2e --only auth,firestore,storage,functions \"playwright test --config playwright.config.ts --project chromium\"",
  "test:e2e:webkit": "npm run build:functions && firebase emulators:exec --project demo-conan-tcg-e2e --only auth,firestore,storage,functions \"playwright test --config playwright.config.ts --project webkit-iphone\"",
  "test:smoke": "node scripts/run-smoke.mjs"
}
```

Append these ignore entries:

```gitignore
playwright-report/
test-results/
blob-report/
*-debug.log
```

- [ ] **Step 4: Verify deterministic installs and the package contract**

Run:

```bash
npm ci
npm --prefix functions ci
node --test scripts/package-contract.test.mjs
```

Expected: both installs exit `0`; contract reports one passing test.

- [ ] **Step 5: Commit the deterministic toolchain**

```bash
git add package.json package-lock.json functions/package-lock.json .gitignore scripts/package-contract.test.mjs
git commit -m "test: pin browser integration toolchain"
```

### Task 2: Add an explicit fail-closed Firebase Emulator mode

**Files:**
- Create: `.env.e2e`
- Create: `src/lib/firebase/emulators.ts`
- Create: `src/lib/firebase/emulators.test.ts`
- Modify: `src/lib/firebase/app.ts`
- Modify: `src/data/firestore/database.ts`
- Modify: `src/vite-env.d.ts`
- Modify: `firebase.json`

**Interfaces:**
- Produces `readFirebaseEmulatorEnv(env, projectId): FirebaseEmulatorConfig | null`.
- Produces `connectFirebaseAppEmulators(config, services): void` and `connectFirestoreToEmulator(config, firestore): void`.
- `firebaseEmulatorConfig` exported from `src/lib/firebase/app.ts` is consumed by Firestore initialization.

- [ ] **Step 1: Write fail-closed parser tests**

```ts
// src/lib/firebase/emulators.test.ts
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

  it('accepts only a demo project on loopback', () => {
    expect(readFirebaseEmulatorEnv(enabled, 'demo-conan-tcg-e2e')).toEqual({
      host: '127.0.0.1', authPort: 9099, firestorePort: 8080,
      storagePort: 9199, functionsPort: 5001,
    });
  });

  it.each([
    [{ ...enabled }, 'conantcgmarket'],
    [{ ...enabled, VITE_FIREBASE_EMULATOR_HOST: '192.168.1.10' }, 'demo-conan-tcg-e2e'],
    [{ ...enabled, VITE_FIREBASE_AUTH_EMULATOR_PORT: 'invalid' }, 'demo-conan-tcg-e2e'],
  ])('rejects unsafe enabled configuration', (env, projectId) => {
    expect(() => readFirebaseEmulatorEnv(env, projectId)).toThrow(/Emulator configuration/);
  });
});
```

- [ ] **Step 2: Run the parser test and verify the missing module failure**

Run: `npm test -- src/lib/firebase/emulators.test.ts`

Expected: FAIL because `./emulators` does not exist.

- [ ] **Step 3: Implement the parser and connector functions**

```ts
// src/lib/firebase/emulators.ts
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
) {
  connectAuthEmulator(services.auth, `http://${config.host}:${config.authPort}`, { disableWarnings: true });
  connectStorageEmulator(services.storage, config.host, config.storagePort);
  connectFunctionsEmulator(services.functions, config.host, config.functionsPort);
}

export function connectFirestoreToEmulator(config: FirebaseEmulatorConfig, firestore: Firestore) {
  connectFirestoreEmulator(firestore, config.host, config.firestorePort);
}
```

In `app.ts`, create `getFunctions(firebaseApp)`, parse `import.meta.env`, connect Auth/Storage/Functions immediately, and export `functionsClient` plus `firebaseEmulatorConfig`. In `database.ts`, connect the newly-created Firestore instance when that exported config is non-null.

- [ ] **Step 4: Track non-secret E2E values and Emulator ports**

```dotenv
# .env.e2e
VITE_FIREBASE_API_KEY=demo-api-key
VITE_FIREBASE_AUTH_DOMAIN=demo-conan-tcg-e2e.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=demo-conan-tcg-e2e
VITE_FIREBASE_STORAGE_BUCKET=demo-conan-tcg-e2e.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=000000000000
VITE_FIREBASE_APP_ID=1:000000000000:web:e2e000000000000000000
VITE_FIREBASE_USE_EMULATORS=true
VITE_FIREBASE_EMULATOR_HOST=127.0.0.1
VITE_FIREBASE_AUTH_EMULATOR_PORT=9099
VITE_FIREBASE_FIRESTORE_EMULATOR_PORT=8080
VITE_FIREBASE_STORAGE_EMULATOR_PORT=9199
VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT=5001
```

Update `firebase.json` so `emulators` contains explicit loopback entries for Auth, Firestore, Functions, and Storage, keeps UI disabled, and enables `singleProjectMode`. Add the matching `ImportMetaEnv` declarations to `src/vite-env.d.ts`.

- [ ] **Step 5: Verify safe parsing, frontend tests, and an E2E-mode build**

Run:

```bash
npm test -- src/lib/firebase/emulators.test.ts src/lib/firebase/config.test.ts
npm run build:e2e
```

Expected: parser tests pass and Vite builds without production Firebase values.

- [ ] **Step 6: Commit explicit Emulator mode**

```bash
git add .env.e2e firebase.json src/vite-env.d.ts src/lib/firebase/emulators.ts src/lib/firebase/emulators.test.ts src/lib/firebase/app.ts src/data/firestore/database.ts
git commit -m "test: add safe firebase emulator mode"
```

### Task 3: Build reusable Emulator state and mock Google helpers

**Files:**
- Create: `e2e/support/emulator-state.ts`
- Create: `e2e/support/auth.ts`
- Create: `e2e/support/fixtures.ts`
- Create: `e2e/support/test.ts`
- Create: `e2e/fixtures/card-front.png`
- Create: `e2e/fixtures/card-back.png`
- Create: `e2e/support/emulator-state.spec.ts`

**Interfaces:**
- Produces `resetEmulators(): Promise<void>`, `seedScenario(seed): Promise<void>`, `seedListingImage(path, fixture): Promise<string>`, `readDocument(collection, id)`, `listDocuments(collection)`, and `listStorageObjects(prefix)`.
- Produces `signInWithMockGoogle(page, identity): Promise<{ uid; email; displayName }>`.
- Produces custom Playwright `test` whose `emulators` fixture resets state before and after each browser test.

- [ ] **Step 1: Write a failing harness integration test**

```ts
// e2e/support/emulator-state.spec.ts
import { expect, test } from '@playwright/test';
import { readDocument, resetEmulators, seedScenario } from './emulator-state';

test('reset and seed own a clean demo project', async () => {
  await resetEmulators();
  await seedScenario({ cards: [{
    key: 'e2e-card-0501', cardId: '0501', cardType: 'character',
    cardName: '諸伏高明', rarities: ['D'],
  }] });
  await expect.poll(() => readDocument('cards', 'e2e-card-0501')).not.toBeNull();
  await resetEmulators();
  await expect.poll(() => readDocument('cards', 'e2e-card-0501')).toBeNull();
});
```

- [ ] **Step 2: Start Emulators around the harness test and verify it fails**

Run:

```bash
npm run build:functions
firebase emulators:exec --project demo-conan-tcg-e2e --only auth,firestore,storage,functions "npx playwright test e2e/support/emulator-state.spec.ts --workers=1"
```

Expected: FAIL because the support module/config does not exist yet.

- [ ] **Step 3: Implement guarded Admin/REST reset, seed, and inspection**

```ts
// e2e/support/emulator-state.ts (public shape)
export const E2E_PROJECT_ID = 'demo-conan-tcg-e2e';
export const E2E_BUCKET = `${E2E_PROJECT_ID}.appspot.com`;

export interface ScenarioSeed {
  cards?: readonly Card[];
  sellerProfiles?: readonly SellerProfile[];
  listings?: readonly Listing[];
  sales?: readonly Sale[];
  notificationSubscriptions?: readonly NotificationSubscription[];
}

export function assertSafeEmulatorEnvironment(env = process.env): void;
export async function resetEmulators(): Promise<void>;
export async function seedScenario(seed: ScenarioSeed): Promise<void>;
export async function seedListingImage(path: string, fixturePath: string): Promise<string>;
export async function readDocument(collectionName: string, id: string): Promise<Record<string, unknown> | null>;
export async function listDocuments(collectionName: string): Promise<Array<{ id: string; data: Record<string, unknown> }>>;
export async function listStorageObjects(prefix: string): Promise<string[]>;
```

Use this guarded implementation pattern; collection writers omit synthetic IDs (`key`, `uid`, or `id`) from document bodies:

```ts
const allowedHosts = new Set(['127.0.0.1', 'localhost', '::1']);

function adminApp() {
  return getApps().find((app) => app.name === 'e2e-admin')
    ?? initializeApp({ projectId: E2E_PROJECT_ID, storageBucket: E2E_BUCKET }, 'e2e-admin');
}

function adminFirestore() { return getFirestore(adminApp()); }
function adminBucket() { return getStorage(adminApp()).bucket(E2E_BUCKET); }

export function assertSafeEmulatorEnvironment(env = process.env) {
  if (env.GCLOUD_PROJECT !== E2E_PROJECT_ID) throw new Error('Unsafe E2E project.');
  for (const key of [
    'FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST',
    'FIREBASE_STORAGE_EMULATOR_HOST',
  ]) {
    const value = env[key];
    const host = value?.startsWith('[')
      ? value.slice(1, value.indexOf(']'))
      : value?.split(':')[0];
    if (!value || !host || !allowedHosts.has(host)) throw new Error(`Unsafe ${key}.`);
  }
}

async function requireOk(method: string, url: string) {
  const response = await fetch(url, { method });
  if (!response.ok) throw new Error(`${method} ${url} failed: ${response.status} ${await response.text()}`);
}

export async function resetEmulators() {
  assertSafeEmulatorEnvironment();
  await requireOk('DELETE', `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${E2E_PROJECT_ID}/accounts`);
  await requireOk('DELETE', `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${E2E_PROJECT_ID}/databases/(default)/documents`);
  await adminBucket().deleteFiles({ force: true });
}

export async function seedScenario(seed: ScenarioSeed) {
  assertSafeEmulatorEnvironment();
  const batch = adminFirestore().batch();
  for (const card of seed.cards ?? []) {
    batch.set(adminFirestore().doc(`cards/${card.key}`), {
      cardId: card.cardId, cardType: card.cardType,
      cardName: card.cardName, rarities: card.rarities,
    });
  }
  for (const profile of seed.sellerProfiles ?? []) {
    batch.set(adminFirestore().doc(`sellerProfiles/${profile.uid}`), {
      displayName: profile.displayName, contactType: profile.contactType,
      contactValue: profile.contactValue,
      createdAt: Timestamp.fromDate(profile.createdAt),
      updatedAt: Timestamp.fromDate(profile.updatedAt),
    });
  }
  for (const listing of seed.listings ?? []) {
    batch.set(adminFirestore().doc(`listings/${listing.id}`), {
      sellerId: listing.sellerId, cardId: listing.cardId,
      cardType: listing.cardType, cardName: listing.cardName,
      ...(listing.characterName ? { characterName: listing.characterName } : {}),
      rarity: listing.rarity, imageUrls: listing.imageUrls,
      listingPrice: listing.listingPrice,
      originalQuantity: listing.originalQuantity,
      remainingQuantity: listing.remainingQuantity,
      hasSleeve: listing.hasSleeve,
      ...(listing.sleeveFee === undefined ? {} : { sleeveFee: listing.sleeveFee }),
      supportsMyShip: listing.supportsMyShip,
      ...(listing.myShipFee === undefined ? {} : { myShipFee: listing.myShipFee }),
      ...(listing.note === undefined ? {} : { note: listing.note }),
      status: listing.status,
      createdAt: Timestamp.fromDate(listing.createdAt),
      updatedAt: Timestamp.fromDate(listing.updatedAt),
    });
  }
  for (const record of seed.sales ?? []) {
    batch.set(adminFirestore().doc(`sales/${record.id}`), {
      listingId: record.listingId, sellerId: record.sellerId,
      cardId: record.cardId, quantity: record.quantity,
      listingUnitPrice: record.listingUnitPrice, soldUnitPrice: record.soldUnitPrice,
      soldAt: Timestamp.fromDate(record.soldAt),
    });
  }
  for (const subscription of seed.notificationSubscriptions ?? []) {
    batch.set(adminFirestore().doc(`notificationSubscriptions/${subscription.uid}`), {
      cardNames: subscription.cardNames,
      emailDailyEnabled: subscription.emailDailyEnabled,
      updatedAt: Timestamp.fromDate(subscription.updatedAt),
    });
  }
  await batch.commit();
}
```

Import `getApps`/`initializeApp`, Admin `getFirestore`/`Timestamp`, and Admin `getStorage`; the remaining exact requirements are:

- `assertSafeEmulatorEnvironment` rejects a non-`demo-` project, missing Emulator host variables, or any host that is not `127.0.0.1`, `localhost`, or `::1`.
- Auth reset calls `DELETE http://127.0.0.1:9099/emulator/v1/projects/demo-conan-tcg-e2e/accounts`.
- Firestore reset calls `DELETE http://127.0.0.1:8080/emulator/v1/projects/demo-conan-tcg-e2e/databases/(default)/documents`.
- Storage reset uses the Admin bucket pointed at `FIREBASE_STORAGE_EMULATOR_HOST` and deletes every object.
- `seedScenario` writes exact collection/document IDs with Admin Firestore and preserves Date values as Firestore timestamps.
- `seedListingImage` uploads a fixture with `firebaseStorageDownloadTokens: 'e2e-token'` and returns the Storage Emulator `v0/b/.../o/...?...` download URL.
- Every non-2xx REST response throws with method, URL, status, and response body; reset never silently continues.
- `readDocument` uses Admin Firestore `get()`, `listDocuments` uses a collection `get()`, and both return plain IDs/data without invoking client Rules.
- `seedListingImage` reads the fixture bytes, saves them with `contentType: 'image/png'` and `firebaseStorageDownloadTokens: 'e2e-token'`, then returns `http://127.0.0.1:9199/v0/b/${encodeURIComponent(E2E_BUCKET)}/o/${encodeURIComponent(path)}?alt=media&token=e2e-token`.

- [ ] **Step 4: Add stable fixture builders and two tiny PNG files**

```ts
// e2e/support/fixtures.ts
export const testCards = [
  { key: 'e2e-card-morofushi', cardId: '0501', cardType: 'character', cardName: '諸伏高明', rarities: ['D'] },
  { key: 'e2e-card-hiromitsu', cardId: '1096', cardType: 'character', cardName: '諸伏景光', rarities: ['R', 'CP'] },
  { key: 'e2e-card-event', cardId: '1100', cardType: 'event', cardName: '追跡開始', rarities: ['C'] },
  { key: 'e2e-card-partner', cardId: 'P001', cardType: 'partner', cardName: '江戶川柯南', rarities: ['P'] },
] as const;

const fixedDate = new Date('2026-08-27T00:00:00.000Z');

export function sellerProfile(uid: string, displayName = 'E2E 賣家'): SellerProfile {
  return {
    uid, displayName, contactType: 'line', contactValue: 'e2e-line',
    createdAt: fixedDate, updatedAt: fixedDate,
  };
}

export function activeListing(
  sellerId: string,
  imageUrl: string,
  overrides: Partial<Listing> = {},
): Listing {
  return {
    id: 'e2e-listing-active', sellerId, cardId: '0501',
    cardType: 'character', cardName: '諸伏高明', characterName: '諸伏高明',
    rarity: 'D', imageUrls: [imageUrl], listingPrice: 500,
    originalQuantity: 5, remainingQuantity: 5, hasSleeve: true, sleeveFee: 20,
    supportsMyShip: true, myShipFee: 10, note: 'E2E 商品備註', status: 'active',
    createdAt: fixedDate, updatedAt: fixedDate, ...overrides,
  };
}

export function sale(sellerId: string, listingId: string, overrides: Partial<Sale> = {}): Sale {
  return {
    id: 'e2e-sale-1', listingId, sellerId, cardId: '0501', quantity: 2,
    listingUnitPrice: 500, soldUnitPrice: 450, soldAt: fixedDate, ...overrides,
  };
}
```

Import `Listing`, `Sale`, and `SellerProfile` from `src/domain/models`. `card-front.png` and `card-back.png` must each be a valid, sub-5 KB PNG so WebKit and Storage decode them consistently.

- [ ] **Step 5: Implement mock Google popup login**

```ts
// e2e/support/auth.ts
import { expect, type Page } from '@playwright/test';

export interface MockGoogleIdentity { email: string; displayName: string }

export async function signInWithMockGoogle(page: Page, identity: MockGoogleIdentity) {
  const existingUid = await lookupAuthEmulatorUid(identity.email, false);
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: '使用 Google 登入' }).click();
  const popup = await popupPromise;
  if (existingUid) {
    await popup.locator('.js-reuse-account').filter({ hasText: identity.email }).click();
  } else {
    await popup.locator('#add-account-button').click();
    await popup.locator('#email-input').fill(identity.email);
    await popup.locator('#display-name-input').fill(identity.displayName);
    await popup.locator('#sign-in').click();
  }
  await popup.waitForEvent('close');
  await expect(page.getByText(`賣家登入中：${identity.displayName}`)).toBeVisible();
  const uid = await lookupAuthEmulatorUid(identity.email, true);
  return { uid, ...identity };
}

async function lookupAuthEmulatorUid(email: string, required: boolean): Promise<string | null> {
  const response = await fetch(`http://127.0.0.1:9099/emulator/v1/projects/demo-conan-tcg-e2e/accounts`);
  if (!response.ok) throw new Error(`Auth account lookup failed: ${response.status}`);
  const body = await response.json() as { users?: Array<{ localId: string; email?: string }> };
  const matches = (body.users ?? []).filter((user) => user.email === email);
  if (matches.length === 0 && !required) return null;
  if (matches.length !== 1) throw new Error(`Expected one Auth Emulator account for ${email}.`);
  return matches[0].localId;
}
```

- [ ] **Step 6: Wrap reset/teardown in a custom Playwright fixture**

```ts
// e2e/support/test.ts
import { test as base, expect } from '@playwright/test';
import { resetEmulators } from './emulator-state';

export const test = base.extend<{ emulators: true }>({
  emulators: [async ({}, use) => {
    await resetEmulators();
    try { await use(true); } finally { await resetEmulators(); }
  }, { auto: true }],
});
export { expect };
```

- [ ] **Step 7: Run the harness test green and commit**

Run the Step 2 command again.

Expected: PASS; the seeded card exists before reset and is absent after reset.

```bash
git add e2e/support e2e/fixtures
git commit -m "test: add firebase emulator e2e harness"
```

### Task 4: Configure deterministic Chromium, WebKit, and smoke projects

**Files:**
- Create: `playwright.config.ts`
- Create: `playwright.smoke.config.ts`
- Create: `scripts/run-smoke.mjs`
- Create: `scripts/e2e-contract.test.mjs`

**Interfaces:**
- Produces Playwright projects named exactly `chromium` and `webkit-iphone`.
- Produces smoke project named `production-smoke` and CLI `npm run test:smoke -- --base-url <url>`.

- [ ] **Step 1: Write the failing E2E configuration contract**

```js
// scripts/e2e-contract.test.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const config = await readFile(new URL('../playwright.config.ts', import.meta.url), 'utf8');
const smoke = await readFile(new URL('../playwright.smoke.config.ts', import.meta.url), 'utf8');

test('keeps the approved reliability and browser matrix', () => {
  for (const text of ['chromium', 'webkit-iphone', 'workers: 1', '30_000', 'failOnFlakyTests']) {
    assert.ok(config.includes(text), `missing ${text}`);
  }
  assert.match(config, /trace:\s*'on-first-retry'/);
  assert.match(config, /video:\s*'retain-on-failure'/);
  assert.ok(smoke.includes('production-smoke'));
  assert.ok(smoke.includes('PLAYWRIGHT_BASE_URL'));
});

test('forbids fixed sleeps in browser specifications', async () => {
  const files = ['public-marketplace', 'card-master', 'auth-profile', 'listing-lifecycle', 'subscriptions', 'sales-authorization', 'mvp-journey', 'mobile-forms', 'smoke'];
  for (const file of files) {
    const source = await readFile(new URL(`../e2e/${file}.spec.ts`, import.meta.url), 'utf8').catch(() => '');
    assert.equal(source.includes('waitForTimeout'), false, `${file} contains a fixed sleep`);
  }
});
```

- [ ] **Step 2: Run the contract and verify config files are missing**

Run: `node --test scripts/e2e-contract.test.mjs`

Expected: FAIL reading `playwright.config.ts`.

- [ ] **Step 3: Implement the full Playwright configuration**

```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['**/smoke.spec.ts', '**/support/**/*.spec.ts'],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: Boolean(process.env.CI),
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  outputDir: 'test-results',
  use: {
    baseURL: 'http://127.0.0.1:4173/ConanTCGMarket/',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: ['**/mobile-forms.spec.ts'],
    },
    {
      name: 'webkit-iphone',
      use: { ...devices['iPhone 13'] },
      testMatch: ['**/mobile-forms.spec.ts'],
    },
  ],
  webServer: {
    command: 'npm run dev -- --mode e2e --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/ConanTCGMarket/',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
```

```ts
// playwright.smoke.config.ts
import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL;
if (!baseURL) throw new Error('PLAYWRIGHT_BASE_URL is required.');

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/smoke.spec.ts',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: Boolean(process.env.CI),
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  outputDir: 'test-results',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'production-smoke', use: { ...devices['Desktop Chrome'] } }],
});
```

- [ ] **Step 4: Implement the smoke command parser without shell interpolation**

```js
// scripts/run-smoke.mjs
import { spawn } from 'node:child_process';

const index = process.argv.indexOf('--base-url');
const value = index >= 0 ? process.argv[index + 1] : undefined;
if (!value) throw new Error('Usage: npm run test:smoke -- --base-url <deployment-url>');
const url = new URL(value);
if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
  throw new Error('Smoke base URL must use HTTPS or loopback HTTP.');
}
const child = spawn(process.execPath, [
  './node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.smoke.config.ts',
], { stdio: 'inherit', env: { ...process.env, PLAYWRIGHT_BASE_URL: url.href } });
child.on('error', (error) => { console.error(error); process.exit(1); });
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
```

- [ ] **Step 5: Verify the contract and list both browser projects**

Run:

```bash
node --test scripts/e2e-contract.test.mjs
npx playwright install chromium webkit
npx playwright test --config playwright.config.ts --list
```

Expected: contract passes; listing shows `chromium` and `webkit-iphone` with no `production-smoke` tests.

- [ ] **Step 6: Commit Playwright configuration**

```bash
git add playwright.config.ts playwright.smoke.config.ts scripts/run-smoke.mjs scripts/e2e-contract.test.mjs
git commit -m "test: configure browser integration projects"
```

### Task 5: Cover public browsing, Card Master, authentication, and Profile

**Files:**
- Create: `e2e/support/ui.ts`
- Create: `e2e/public-marketplace.spec.ts`
- Create: `e2e/card-master.spec.ts`
- Create: `e2e/auth-profile.spec.ts`

**Interfaces:**
- Produces `acknowledgeWelcome(page)`, `createSellerProfile(page, values)`, and `selectCardMetadata(page, values)` for later Listing/mobile journeys.
- Consumes the reset/seed/auth helpers from Tasks 3–4.

- [ ] **Step 1: Add reusable UI actions with role/label selectors**

```ts
// e2e/support/ui.ts
import { expect, type Page } from '@playwright/test';

export async function acknowledgeWelcome(page: Page) {
  const dialog = page.getByRole('dialog', { name: '網站使用與安全提醒' });
  if (await dialog.isVisible()) await dialog.getByRole('button', { name: '我知道了' }).click();
}

export async function createSellerProfile(page: Page, values = {
  displayName: 'E2E 賣家', contactType: 'discord', contactValue: 'e2e-seller',
}) {
  await page.goto('#/profile');
  await page.getByLabel('顯示名稱').fill(values.displayName);
  await page.getByLabel('聯絡方式').selectOption(values.contactType);
  await page.getByLabel('聯絡帳號或連結').fill(values.contactValue);
  await page.getByRole('button', { name: '儲存個人檔案' }).click();
  await expect(page.getByRole('status')).toContainText('已儲存個人檔案');
}

export async function selectCardMetadata(page: Page, values: {
  cardType: string; cardName: string; rarity: string; cardId: string;
}) {
  await page.getByLabel('卡片類型').selectOption(values.cardType);
  await page.getByLabel('卡片名稱').fill(values.cardName);
  await page.getByLabel('稀有度').selectOption(values.rarity);
  await page.getByLabel('卡片 ID').fill(values.cardId);
}

export async function createListingThroughUi(page: Page, imagePaths: string[]): Promise<string> {
  await page.goto('#/sell');
  await selectCardMetadata(page, {
    cardType: 'character', cardName: '諸伏高明', rarity: 'D', cardId: '0501',
  });
  await page.getByLabel('商品圖片').setInputFiles(imagePaths);
  await page.getByLabel('價格').fill('500');
  await page.getByLabel('數量').fill('5');
  await page.getByLabel('包手').check();
  await page.getByLabel('包材費').fill('20');
  await page.getByLabel('支援賣貨便').check();
  await page.getByLabel('賣貨便加價').fill('10');
  await page.getByLabel('備註').fill('E2E 商品備註');
  await page.getByRole('button', { name: '刊登商品' }).click();
  await expect(page).toHaveURL(/#\/listing\/[^/]+$/);
  return new URL(page.url()).hash.split('/').at(-1)!;
}
```

- [ ] **Step 2: Write the public Marketplace integration tests**

```ts
// e2e/public-marketplace.spec.ts
import { fileURLToPath } from 'node:url';
import { test, expect } from './support/test';
import { activeListing, sellerProfile, testCards } from './support/fixtures';
import { seedListingImage, seedScenario } from './support/emulator-state';

test('acknowledges the notice and filters an active public listing', async ({ page, emulators }) => {
  void emulators;
  const image = await seedListingImage(
    'listings/seller-public/e2e-listing-active/front.png',
    fileURLToPath(new URL('./fixtures/card-front.png', import.meta.url)),
  );
  await seedScenario({
    cards: testCards,
    sellerProfiles: [sellerProfile('seller-public', '公開賣家')],
    listings: [activeListing('seller-public', image)],
  });
  await page.goto('./');
  const notice = page.getByRole('dialog', { name: '網站使用與安全提醒' });
  await expect(notice).toBeVisible();
  await expect(notice.getByRole('link', { name: 'rugiacreation.com' }).first())
    .toHaveAttribute('href', 'https://rugiacreation.com/conan/search');
  await notice.getByRole('button', { name: '我知道了' }).click();
  await page.reload();
  await expect(notice).toBeHidden();
  await page.getByLabel('卡片類型').selectOption('character');
  await page.getByLabel('卡片名稱').fill('諸伏高明');
  await page.getByLabel('稀有度').selectOption('D');
  await page.getByLabel('搜尋卡片 ID').fill('0501');
  await page.getByLabel('包手').check();
  await page.getByLabel('支援賣貨便').check();
  const card = page.getByRole('link', { name: /諸伏高明/ });
  await expect(card).toContainText('ID 0501');
  await expect(card).toContainText('NT$500');
  await expect(card).toContainText('公開賣家');
  await card.click();
  await expect(page).toHaveURL(/#\/listing\/e2e-listing-active$/);
  await expect(page.getByRole('heading', { name: '商品詳情' })).toBeVisible();
  await expect(page.getByText('以 line 聯絡：e2e-line')).toBeVisible();
});
```

Implement this exact matrix in the same file:

| Test name | Setup/action | Required assertion |
| --- | --- | --- |
| `shows an empty public market` | Seed Card Master only, open `/` | `目前沒有符合條件的商品。` |
| `never exposes sold-out Listings` | Seed one active and one sold-out Listing | Active accessible link count is one; sold-out name/ID count is zero |
| `validates and clears independent ID search` | Fill `B001`, assert alert, clear it | Alert disappears and active result returns |
| `renders loading until Firestore responds` | Route-gate the first `127.0.0.1:8080` request with a manually resolved Promise | `商品載入中` before release; populated result after `route.continue()` |
| `renders the Firestore error state` | Abort every `127.0.0.1:8080` request before navigation | `無法載入商品，請稍後再試。` appears as an alert |

The request gate resolves from the test body; it must not use `setTimeout` or `waitForTimeout`.

- [ ] **Step 3: Write standalone Card Master browser coverage**

```ts
// e2e/card-master.spec.ts
import { test, expect } from './support/test';
import { seedScenario } from './support/emulator-state';
import { testCards } from './support/fixtures';

test('searches, selects, summarizes, and clears a Card Master result', async ({ page }) => {
  await seedScenario({ cards: testCards });
  await page.goto('#/cards');
  await page.getByLabel('搜尋卡牌').fill('諸伏');
  await page.getByRole('button', { name: /角色卡 · 諸伏高明 · ID 0501 · D/ }).click();
  const summary = page.getByRole('heading', { name: '已選擇卡牌' }).locator('..');
  await expect(summary).toContainText('0501');
  await expect(summary).toContainText('角色卡');
  await expect(summary).toContainText('諸伏高明');
  await expect(summary).toContainText('D');
  await page.getByRole('button', { name: '清除已選擇的卡牌' }).click();
  await expect(page.getByRole('heading', { name: '已選擇卡牌' })).toBeHidden();
  await page.getByLabel('搜尋卡牌').fill('不存在卡片');
  await expect(page.getByRole('status')).toHaveText('找不到符合的卡牌。');
});
```

Add clean-reset empty state and aborted-Firestore error tests. Hold/release the first request to assert `載入卡牌資料中`; do not use time-based waits.

- [ ] **Step 4: Write the Auth Emulator and Profile lifecycle test**

```ts
// e2e/auth-profile.spec.ts
import { test, expect } from './support/test';
import { readDocument } from './support/emulator-state';
import { signInWithMockGoogle } from './support/auth';
import { acknowledgeWelcome, createSellerProfile } from './support/ui';

test('signs in, creates and edits a Profile, reloads, then signs out', async ({ page }) => {
  await page.goto('./');
  await acknowledgeWelcome(page);
  const identity = await signInWithMockGoogle(page, {
    email: 'seller-profile@example.test', displayName: 'Profile Seller',
  });
  await createSellerProfile(page);
  await expect.poll(() => readDocument('sellerProfiles', identity.uid)).toMatchObject({
    displayName: 'E2E 賣家', contactType: 'discord', contactValue: 'e2e-seller',
  });
  await page.getByLabel('顯示名稱').fill('更新後賣家');
  await page.getByLabel('聯絡方式').selectOption('threads');
  await page.getByLabel('聯絡帳號或連結').fill('@updated');
  await page.getByRole('button', { name: '儲存個人檔案' }).click();
  await page.reload();
  await expect(page.getByLabel('顯示名稱')).toHaveValue('更新後賣家');
  await page.goto('./');
  await page.getByRole('button', { name: '登出' }).click();
  await expect(page.getByText('買家可直接瀏覽；賣家上架需登入')).toBeVisible();
  await page.goto('#/profile');
  await expect(page.getByText('請先使用 Google 登入')).toBeVisible();
});
```

- [ ] **Step 5: Run Chromium public/auth tests and commit**

Run:

```bash
firebase emulators:exec --project demo-conan-tcg-e2e --only auth,firestore,storage,functions "npx playwright test e2e/public-marketplace.spec.ts e2e/card-master.spec.ts e2e/auth-profile.spec.ts --config playwright.config.ts --project chromium"
```

Expected: all public, Card Master, Auth, and Profile cases pass with one worker.

```bash
git add e2e/support/ui.ts e2e/public-marketplace.spec.ts e2e/card-master.spec.ts e2e/auth-profile.spec.ts
git commit -m "test: cover public browsing and seller profiles"
```

### Task 6: Cover Listing creation, trigger, editing, image replacement, and deletion

**Files:**
- Create: `e2e/listing-lifecycle.spec.ts`

**Interfaces:**
- Consumes `selectCardMetadata`, `seedListingImage`, `readDocument`, and `listStorageObjects`.
- Proves the Functions Emulator writes `listingEvents/{listingId}` after the browser creates a Listing.

- [ ] **Step 1: Write the create/trigger success path**

```ts
// e2e/listing-lifecycle.spec.ts
import { fileURLToPath } from 'node:url';
import { test, expect } from './support/test';
import { signInWithMockGoogle } from './support/auth';
import { listStorageObjects, readDocument, seedScenario } from './support/emulator-state';
import { testCards } from './support/fixtures';
import { createSellerProfile, selectCardMetadata } from './support/ui';

const front = fileURLToPath(new URL('./fixtures/card-front.png', import.meta.url));
const back = fileURLToPath(new URL('./fixtures/card-back.png', import.meta.url));

test('creates a complete Listing, uploads images, and captures its event', async ({ page }) => {
  await seedScenario({ cards: testCards });
  await page.goto('./');
  const seller = await signInWithMockGoogle(page, {
    email: 'listing-owner@example.test', displayName: 'Listing Owner',
  });
  await createSellerProfile(page);
  await page.goto('#/sell');
  await selectCardMetadata(page, {
    cardType: 'character', cardName: '諸伏高明', rarity: 'D', cardId: '0501',
  });
  await page.getByLabel('商品圖片').setInputFiles([front, back]);
  await page.getByLabel('價格').fill('500');
  await page.getByLabel('數量').fill('5');
  await page.getByLabel('包手').check();
  await page.getByLabel('包材費').fill('20');
  await page.getByLabel('支援賣貨便').check();
  await page.getByLabel('賣貨便加價').fill('10');
  await page.getByLabel('備註').fill('E2E 商品備註');
  await page.getByRole('button', { name: '刊登商品' }).click();
  await expect(page).toHaveURL(/#\/listing\/[^/]+$/);
  const listingId = new URL(page.url()).hash.split('/').at(-1)!;
  await expect.poll(() => readDocument('listings', listingId)).toMatchObject({
    sellerId: seller.uid, cardType: 'character', cardName: '諸伏高明',
    rarity: 'D', cardId: '0501', listingPrice: 500,
    originalQuantity: 5, remainingQuantity: 5, hasSleeve: true,
    sleeveFee: 20, supportsMyShip: true, myShipFee: 10,
    status: 'active', note: 'E2E 商品備註',
  });
  await expect.poll(() => listStorageObjects(`listings/${seller.uid}/${listingId}/`))
    .toHaveLength(2);
  await expect.poll(() => readDocument('listingEvents', listingId)).toMatchObject({
    listingId, cardName: '諸伏高明', cardId: '0501', rarity: 'D',
    discordStatus: 'disabled',
  });
  await page.goto('./');
  await expect(page.getByRole('link', { name: /諸伏高明/ })).toBeVisible();
});
```

- [ ] **Step 2: Add create failures with no Firestore write**

Implement this exact rejection matrix:

| Test name | Browser action | Backend invariant |
| --- | --- | --- |
| `requires login to sell` | Open `#/sell` signed out | Login guidance; zero Listings |
| `requires a seller Profile` | Sign in, open `#/sell` without Profile | `前往設定個人檔案`; zero Listings |
| `rejects missing required Listing fields` | Submit the untouched form | Required role alerts; zero Listings/objects |
| `rejects unknown Card Master tuple` | Select valid type/name/rarity, replace ID with `9999`, submit | Database tuple alert; zero Listings/objects |
| `rejects more than three images` | Select the two fixtures twice as four files and submit | One-to-three image alert; zero Listings/objects |

- [ ] **Step 3: Add owner edit, sold-inventory rejection, and image replacement**

Use `signInWithMockGoogle`, then seed the Profile, an active Listing with `originalQuantity: 5` and `remainingQuantity: 3`, one old Storage image, and one Sale of quantity `2`. Navigate to the edit hash and:

```ts
await page.getByLabel('價格').fill('450');
await page.getByLabel('剩餘數量').fill('1');
await page.getByRole('button', { name: '儲存變更' }).click();
await expect(page.getByRole('alert')).toContainText('價格、庫存或圖片不正確');
await page.getByLabel('剩餘數量').fill('3');
await page.getByLabel('替換商品圖片').setInputFiles(back);
await page.getByRole('button', { name: '儲存變更' }).click();
await expect(page.getByRole('status')).toHaveText('已更新商品');
```

Poll until the Listing price is `450`, its new image URL differs from the old URL, the new Storage object exists, and the old object is deleted. Also assert the page shows existing images before selecting a replacement.

- [ ] **Step 4: Add permission, cancel-delete, and confirmed-delete paths**

Create owner and other-seller Auth Emulator accounts. Seed the Listing for the owner. As the other seller, navigate to edit and assert `無法編輯商品` with no management form. Sign back in as owner, dismiss the first browser confirmation and prove the Listing/image remain; accept the second confirmation and poll until both the document and all objects under the Listing prefix are absent. Assert the final hash is `#/dashboard`.

- [ ] **Step 5: Run Listing lifecycle tests and commit**

Run: `firebase emulators:exec --project demo-conan-tcg-e2e --only auth,firestore,storage,functions "npx playwright test e2e/listing-lifecycle.spec.ts --config playwright.config.ts --project chromium"`

Expected: all Listing validation, Functions trigger, update, replacement, ownership, and deletion cases pass.

```bash
git add e2e/listing-lifecycle.spec.ts
git commit -m "test: cover listing lifecycle integration"
```

### Task 7: Cover card-name subscription workflows and fake-email boundary

**Files:**
- Create: `e2e/subscriptions.spec.ts`
- Verify: `functions/src/dailyDigest.test.ts`

**Interfaces:**
- Browser tests inspect `notificationSubscriptions/{uid}` only through the Emulator Admin helper.
- Functions tests continue consuming `DailyDigestDependencies` with an in-memory `gmail.sendDigest` fake; no Gmail client or secret is instantiated.

- [ ] **Step 1: Write sign-in guidance and subscribe/manage success tests**

```ts
// e2e/subscriptions.spec.ts
import { test, expect } from './support/test';
import { signInWithMockGoogle } from './support/auth';
import { readDocument, seedScenario } from './support/emulator-state';
import { testCards } from './support/fixtures';
import { acknowledgeWelcome } from './support/ui';

test('subscribes to an exact name with explicit email consent and manages it', async ({ page }) => {
  await seedScenario({ cards: testCards });
  await page.goto('./');
  await acknowledgeWelcome(page);
  await page.getByLabel('卡片類型').selectOption('character');
  await page.getByLabel('卡片名稱').fill('諸伏高明');
  await page.getByRole('button', { name: '訂閱諸伏高明' }).click();
  await expect(page.getByText('登入後即可訂閱卡名通知')).toBeVisible();
  const buyer = await signInWithMockGoogle(page, {
    email: 'subscription-buyer@example.test', displayName: 'Subscription Buyer',
  });
  await page.getByRole('button', { name: '訂閱諸伏高明' }).click();
  await expect(page.getByRole('button', { name: '確認訂閱' })).toBeDisabled();
  await page.getByLabel('以 Google 登入信箱接收每日摘要').check();
  await page.getByRole('button', { name: '確認訂閱' }).click();
  await expect(page.getByText('已訂閱「諸伏高明」的每日摘要通知。')).toBeVisible();
  await expect.poll(() => readDocument('notificationSubscriptions', buyer.uid)).toMatchObject({
    cardNames: ['諸伏高明'], emailDailyEnabled: true,
  });
  await page.goto('#/notifications');
  await expect(page.getByText('諸伏高明')).toBeVisible();
  await page.getByLabel('每日彙整 Email 通知').uncheck();
  await expect.poll(() => readDocument('notificationSubscriptions', buyer.uid))
    .toMatchObject({ emailDailyEnabled: false });
  await page.reload();
  await expect(page.getByLabel('每日彙整 Email 通知')).not.toBeChecked();
  await page.getByRole('button', { name: '移除諸伏高明訂閱' }).click();
  await expect(page.getByText('尚未訂閱任何卡名。')).toBeVisible();
});
```

- [ ] **Step 2: Add covered-name, detail-surface, and cancellation cases**

Implement this exact browser matrix:

| Test name | Action | Firestore/UI assertion |
| --- | --- | --- |
| `cancels notification-method selection` | Open confirmation, click `取消` | No subscription document |
| `subscribes from Listing details` | Open seeded active Listing and confirm email | Exact card name and `emailDailyEnabled: true` |
| `shows raw-substring coverage` | Seed card name `諸伏`, view `諸伏高明` | `已由「諸伏」訂閱涵蓋`; management link visible |
| `removes only the selected exact name` | Seed two names, remove one, reload | Other name persists in UI and Firestore |
| `toggles an exact active subscription off` | Click `取消訂閱諸伏高明` | Name absent after reload; remaining canonical state unchanged |

- [ ] **Step 3: Verify the existing fake Gmail backend integration boundary**

Run `npm --prefix functions exec vitest run src/dailyDigest.test.ts` and confirm the existing tests prove all of these contracts: raw substring matching across card types, one fake `sendDigest` invocation for matched events, subject/text/HTML/Listing links and card metadata, `completeWithoutSend` with zero Gmail calls for no-match, recipient caps/pagination, claim ambiguity, and recovery. Do not add a duplicate test unless one of those named assertions is actually absent; the current file already contains them.

- [ ] **Step 4: Run browser and Functions tests, then commit**

Run:

```bash
firebase emulators:exec --project demo-conan-tcg-e2e --only auth,firestore,storage,functions "npx playwright test e2e/subscriptions.spec.ts --config playwright.config.ts --project chromium"
npm --prefix functions exec vitest run src/dailyDigest.test.ts
```

Expected: subscription UI tests pass; Functions fake captures matching content and records zero sends for no-match.

```bash
git add e2e/subscriptions.spec.ts
git commit -m "test: cover subscription and digest integration"
```

### Task 8: Cover sales, Dashboard, authorization, and the cross-module MVP journey

**Files:**
- Create: `e2e/sales-authorization.spec.ts`
- Create: `e2e/mvp-journey.spec.ts`
- Modify: `src/rules/firebaseRules.test.ts`

**Interfaces:**
- Consumes fixed Listing/Sale seeds and mock identities.
- Existing Rules Emulator suite remains the exhaustive direct-client authorization matrix; Chromium covers user-visible denial states.

- [ ] **Step 1: Write Dashboard partial-sale and sold-out paths**

```ts
// e2e/sales-authorization.spec.ts
import { fileURLToPath } from 'node:url';
import { test, expect } from './support/test';
import { signInWithMockGoogle } from './support/auth';
import { activeListing, sellerProfile, testCards } from './support/fixtures';
import { readDocument, seedListingImage, seedScenario } from './support/emulator-state';

const fixturePath = fileURLToPath(new URL('./fixtures/card-front.png', import.meta.url));

test('records partial and sold-out sales and updates Dashboard totals', async ({ page }) => {
  await page.goto('./');
  const owner = await signInWithMockGoogle(page, {
    email: 'sales-owner@example.test', displayName: 'Sales Owner',
  });
  const image = await seedListingImage(`listings/${owner.uid}/e2e-sale-listing/front.png`, fixturePath);
  await seedScenario({
    cards: testCards,
    sellerProfiles: [sellerProfile(owner.uid)],
    listings: [activeListing(owner.uid, image, { id: 'e2e-sale-listing' })],
  });
  await page.goto('#/dashboard');
  await expect(page.getByText('販售中：1')).toBeVisible();
  await page.getByRole('button', { name: '登記成交' }).click();
  const dialog = page.getByRole('dialog', { name: '登記成交' });
  await expect(dialog.getByLabel('數量')).toHaveValue('1');
  await expect(dialog.getByLabel('實際單價')).toHaveValue('500');
  await dialog.getByLabel('數量').fill('2');
  await dialog.getByLabel('實際單價').fill('450');
  await dialog.getByRole('button', { name: '確認成交' }).click();
  await expect(page.getByText('已售張數：2')).toBeVisible();
  await expect(page.getByText('成交金額：NT$900')).toBeVisible();
  await expect.poll(() => readDocument('listings', 'e2e-sale-listing'))
    .toMatchObject({ remainingQuantity: 3, status: 'active' });
  await page.getByRole('button', { name: '登記成交' }).click();
  await dialog.getByLabel('數量').fill('3');
  await dialog.getByRole('button', { name: '確認成交' }).click();
  await expect(page.getByText('販售中：0')).toBeVisible();
  await expect(page.getByRole('heading', { name: '已售罄' }).locator('..')).toContainText('諸伏高明');
  await page.goto('./');
  await expect(page.getByRole('link', { name: /諸伏高明/ })).toHaveCount(0);
});
```

Add modal cancel, invalid zero/decimal/oversell quantity, and invalid price tests; each must assert the dialog stays open, the alert is visible, and Listing/Sales state is unchanged.

- [ ] **Step 2: Add user-visible authorization cases**

Seed an owner Listing, then sign in as a second seller. Assert the details page has no `管理此商品`, direct edit hash renders `無法編輯商品`, and Dashboard never lists the owner's Listing or Sale. Sign out and assert Profile, sell, Dashboard, and notification routes each show their signed-out guidance.

- [ ] **Step 3: Expand direct Rules coverage for every high-risk backend operation**

Add Rules Emulator cases that assert:

```ts
const saleData = {
  listingId: 'active', sellerId: 'seller-a', cardId: '0501', quantity: 1,
  listingUnitPrice: 500, soldUnitPrice: 450, soldAt: new Date(),
};
await assertFails(setDoc(doc(unauthenticated, 'listings', 'blocked'), eventListing));
await assertFails(setDoc(doc(otherSeller, 'sales', 'cross-sale'), { ...saleData, sellerId: 'seller-a' }));
await assertFails(getDocs(query(collection(otherSeller, 'sales'), where('sellerId', '==', 'seller-a'))));
await assertFails(deleteObject(ref(otherStorage, 'listings/seller-a/listing-1/card.jpg')));
await assertFails(getDoc(doc(publicDb, 'notificationSubscriptions', 'buyer-a')));
```

Extend the Storage import with `deleteObject`. Keep positive owner create/query/delete controls beside each denial so a failure cannot be caused merely by malformed seed data.

- [ ] **Step 4: Write the isolated end-to-end MVP composition journey**

```ts
// e2e/mvp-journey.spec.ts
import { fileURLToPath } from 'node:url';
import { test, expect } from './support/test';
import { signInWithMockGoogle } from './support/auth';
import {
  listDocuments, listStorageObjects, readDocument, seedScenario,
} from './support/emulator-state';
import { testCards } from './support/fixtures';
import {
  acknowledgeWelcome, createListingThroughUi, createSellerProfile,
} from './support/ui';

const front = fileURLToPath(new URL('./fixtures/card-front.png', import.meta.url));

test('composes login, Profile, Listing, search, subscription, sale, and sold-out removal', async ({ page }) => {
  await seedScenario({ cards: testCards });
  await page.goto('./');
  await acknowledgeWelcome(page);
  const owner = await signInWithMockGoogle(page, {
    email: 'mvp-owner@example.test', displayName: 'MVP Owner',
  });
  await createSellerProfile(page);
  const listingId = await createListingThroughUi(page, [front]);
  await expect.poll(() => readDocument('listingEvents', listingId)).not.toBeNull();
  await expect.poll(() => listStorageObjects(`listings/${owner.uid}/${listingId}/`)).toHaveLength(1);

  await page.goto('./');
  await page.getByLabel('卡片類型').selectOption('character');
  await page.getByLabel('卡片名稱').fill('諸伏高明');
  await page.getByLabel('稀有度').selectOption('D');
  await page.getByLabel('搜尋卡片 ID').fill('0501');
  await page.getByRole('link', { name: /諸伏高明/ }).click();
  await page.getByRole('button', { name: '訂閱諸伏高明' }).click();
  await page.getByLabel('以 Google 登入信箱接收每日摘要').check();
  await page.getByRole('button', { name: '確認訂閱' }).click();
  await expect.poll(() => readDocument('notificationSubscriptions', owner.uid))
    .toMatchObject({ cardNames: ['諸伏高明'], emailDailyEnabled: true });

  await page.goto('#/dashboard');
  await page.getByRole('button', { name: '登記成交' }).click();
  let dialog = page.getByRole('dialog', { name: '登記成交' });
  await dialog.getByLabel('數量').fill('2');
  await dialog.getByLabel('實際單價').fill('450');
  await dialog.getByRole('button', { name: '確認成交' }).click();
  await expect(page.getByText('成交金額：NT$900')).toBeVisible();
  await expect.poll(() => readDocument('listings', listingId))
    .toMatchObject({ remainingQuantity: 3, status: 'active' });
  await expect.poll(() => listDocuments('sales')).toHaveLength(1);

  await page.getByRole('button', { name: '登記成交' }).click();
  dialog = page.getByRole('dialog', { name: '登記成交' });
  await dialog.getByLabel('數量').fill('3');
  await dialog.getByRole('button', { name: '確認成交' }).click();
  await expect.poll(() => readDocument('listings', listingId))
    .toMatchObject({ remainingQuantity: 0, status: 'sold_out' });
  await expect.poll(() => listDocuments('sales')).toHaveLength(2);
  await page.goto('./');
  await expect(page.getByRole('link', { name: /諸伏高明/ })).toHaveCount(0);
});
```

- [ ] **Step 5: Run Rules, sales, and MVP tests and commit**

Run:

```bash
npm run test:rules
firebase emulators:exec --project demo-conan-tcg-e2e --only auth,firestore,storage,functions "npx playwright test e2e/sales-authorization.spec.ts e2e/mvp-journey.spec.ts --config playwright.config.ts --project chromium"
```

Expected: Rules suite and both Chromium specs pass; no production credentials are present.

```bash
git add src/rules/firebaseRules.test.ts e2e/sales-authorization.spec.ts e2e/mvp-journey.spec.ts
git commit -m "test: cover sales authorization and mvp journey"
```

### Task 9: Repeat core flows and every form on WebKit iPhone

**Files:**
- Create: `e2e/mobile-forms.spec.ts`

**Interfaces:**
- Runs only in project `webkit-iphone`.
- Reuses UI helpers and backend polling; it does not duplicate the complete Rules matrix.

- [ ] **Step 1: Write the mobile navigation/marketplace interaction test**

```ts
// e2e/mobile-forms.spec.ts
import { fileURLToPath } from 'node:url';
import { test, expect } from './support/test';
import { activeListing, sellerProfile, testCards } from './support/fixtures';
import { seedListingImage, seedScenario } from './support/emulator-state';

test('mobile welcome, filters, result navigation, and subscriptions remain interactive', async ({ page }) => {
  const image = await seedListingImage(
    'listings/mobile-seller/e2e-listing-active/front.png',
    fileURLToPath(new URL('./fixtures/card-front.png', import.meta.url)),
  );
  await seedScenario({
    cards: testCards,
    sellerProfiles: [sellerProfile('mobile-seller', 'Mobile Seller')],
    listings: [activeListing('mobile-seller', image)],
  });
  await page.goto('./');
  await expect(page.getByRole('dialog', { name: '網站使用與安全提醒' })).toBeVisible();
  await page.getByRole('button', { name: '我知道了' }).tap();
  await page.getByLabel('卡片類型').selectOption('character');
  await page.getByLabel('卡片名稱').fill('諸伏');
  await expect(page.getByLabel('卡片名稱')).toHaveValue('諸伏');
  await page.getByLabel('卡片名稱').fill('諸伏高明');
  await page.getByLabel('稀有度').selectOption('D');
  await page.getByLabel('搜尋卡片 ID').fill('0501');
  await page.getByRole('link', { name: /諸伏高明/ }).tap();
  await expect(page.getByRole('heading', { name: '商品詳情' })).toBeVisible();
  await expect.poll(async () => {
    const size = await page.locator('body').evaluate((body) => ({
      clientWidth: body.clientWidth, scrollWidth: body.scrollWidth,
    }));
    return size.scrollWidth <= size.clientWidth;
  }).toBe(true);
});
```

The overflow assertion intentionally compares the measured dimensions instead of hard-coding an iPhone width.

- [ ] **Step 2: Add one WebKit test for each form surface**

Implement this exact WebKit matrix:

| Test name | Required controls | Backend assertion |
| --- | --- | --- |
| `mobile Profile form` | display name, all contact-type options, contact value, empty validation, save, reload | Profile matches final values |
| `mobile sell form` | type/name/rarity/ID, 1–3 picker, price, quantity, sleeve/fee, MyShip/fee, note, required validation, submit | Listing and uploaded objects match |
| `mobile Listing edit form` | existing preview, optional replacement, price, remaining quantity, both flags/fees, note, save, delete cancel | Updated Listing/new object; old object gone; cancel keeps Listing |
| `mobile sale dialog` | defaults, zero/oversell validation, cancel, partial sale | One Sale and decremented inventory only after confirm |
| `mobile subscription confirmation` | disabled confirm, email checkbox, cancel, reopen, confirm | Exact subscription saved once |
| `mobile notification settings` | list, daily-email toggle, remove | Preference and card-name array persist |

Each case must verify the input is editable with iPhone touch/media settings and poll the corresponding Emulator document after submit.

- [ ] **Step 3: Run WebKit alone and commit**

Run: `npm run test:e2e:webkit`

Expected: every `mobile-forms.spec.ts` case passes in the iPhone WebKit project with no overlap or horizontal-scroll regression.

```bash
git add e2e/mobile-forms.spec.ts
git commit -m "test: cover mobile webkit user forms"
```

### Task 10: Gate GitHub Pages with quality, Rules, E2E, deploy, and smoke jobs

**Files:**
- Create: `scripts/workflow-contract.test.mjs`
- Modify: `.github/workflows/deploy.yml`
- Create: `e2e/smoke.spec.ts`

**Interfaces:**
- Workflow exposes jobs named exactly `quality`, `rules`, `e2e`, `deploy`, and `smoke`.
- `deploy` outputs `page_url`; `smoke` consumes that URL through `npm run test:smoke -- --base-url`.

- [ ] **Step 1: Write a failing workflow contract**

```js
// scripts/workflow-contract.test.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');

test('runs all gates for PR and main while deployment depends on them', () => {
  for (const token of ['pull_request:', 'quality:', 'rules:', 'e2e:', 'deploy:', 'smoke:']) {
    assert.ok(workflow.includes(token), `missing ${token}`);
  }
  assert.match(workflow, /deploy:[\s\S]*needs:\s*\[quality, rules, e2e\]/);
  assert.match(workflow, /smoke:[\s\S]*needs:\s*deploy/);
  assert.match(workflow, /if:\s*github\.event_name == 'push'/);
  assert.ok(workflow.includes('pages: write'));
  assert.ok(workflow.includes('id-token: write'));
  assert.ok(workflow.includes('retention-days: 14'));
  assert.ok(workflow.includes('if: always()'));
});
```

- [ ] **Step 2: Run the workflow contract and verify the old single build job fails**

Run: `node --test scripts/workflow-contract.test.mjs`

Expected: FAIL because the workflow has no PR trigger or layered gates.

- [ ] **Step 3: Implement a read-only production smoke specification**

```ts
// e2e/smoke.spec.ts
import { test, expect } from '@playwright/test';

test('deployed public routes and assets load without configuration errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const response = await page.goto('./');
  expect(response?.ok()).toBe(true);
  await expect(page.getByRole('heading', { name: '搜尋正在販售的柯南 TCG 卡牌' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '網站使用與安全提醒' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'rugiacreation.com' }).first())
    .toHaveAttribute('href', 'https://rugiacreation.com/conan/search');
  for (const hash of ['#/cards', '#/profile', '#/sell', '#/dashboard', '#/notifications']) {
    await page.goto(hash);
    await expect(page.locator('main')).toBeVisible();
  }
  expect(errors.filter((message) => /Firebase|configuration-not-found/i.test(message))).toEqual([]);
});
```

The smoke file must not import Emulator/Admin/auth helpers and must contain no click on sign-in, mutation, upload, subscription, sale, or delete controls.

- [ ] **Step 4: Replace the workflow with the five approved jobs**

Implement this workflow, retaining the existing repository-variable names:

```yaml
name: Test and deploy GitHub Pages

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: pages-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Setup Node
        uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - name: Install frontend dependencies
        run: npm ci
      - name: Install Functions dependencies
        run: npm --prefix functions ci
      - name: Run quality gates
        run: npm run test:quality

  rules:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Setup Node
        uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - name: Setup Java
        uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: 21 }
      - name: Cache Firebase Emulators
        uses: actions/cache@v4
        with:
          path: ~/.cache/firebase/emulators
          key: firebase-emulators-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
      - name: Install dependencies
        run: npm ci
      - name: Test Firebase Rules
        run: npm run test:rules
      - name: Upload Rules Emulator logs
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: rules-emulator-logs
          path: '*-debug.log'
          if-no-files-found: ignore
          retention-days: 14

  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Setup Node
        uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - name: Setup Java
        uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: 21 }
      - name: Cache Firebase Emulators
        uses: actions/cache@v4
        with:
          path: ~/.cache/firebase/emulators
          key: firebase-emulators-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
      - name: Install frontend dependencies
        run: npm ci
      - name: Install Functions dependencies
        run: npm --prefix functions ci
      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium webkit
      - name: Run Emulator E2E
        run: npm run test:e2e
      - name: Upload E2E evidence
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: e2e-artifacts
          retention-days: 14
          if-no-files-found: ignore
          path: |
            playwright-report/
            test-results/
            *-debug.log

  deploy:
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    needs: [quality, rules, e2e]
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pages: write
      id-token: write
    outputs:
      page_url: ${{ steps.deployment.outputs.page_url }}
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Setup Node
        uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - name: Install dependencies
        run: npm ci
      - name: Validate Firebase configuration
        shell: bash
        run: |
          for variable in VITE_FIREBASE_API_KEY VITE_FIREBASE_AUTH_DOMAIN VITE_FIREBASE_PROJECT_ID VITE_FIREBASE_STORAGE_BUCKET VITE_FIREBASE_MESSAGING_SENDER_ID VITE_FIREBASE_APP_ID; do
            if [ -z "${!variable}" ]; then
              echo "Missing required repository variable: ${variable}" >&2
              exit 1
            fi
          done
        env:
          VITE_FIREBASE_API_KEY: ${{ vars.VITE_FIREBASE_API_KEY }}
          VITE_FIREBASE_AUTH_DOMAIN: ${{ vars.VITE_FIREBASE_AUTH_DOMAIN }}
          VITE_FIREBASE_PROJECT_ID: ${{ vars.VITE_FIREBASE_PROJECT_ID }}
          VITE_FIREBASE_STORAGE_BUCKET: ${{ vars.VITE_FIREBASE_STORAGE_BUCKET }}
          VITE_FIREBASE_MESSAGING_SENDER_ID: ${{ vars.VITE_FIREBASE_MESSAGING_SENDER_ID }}
          VITE_FIREBASE_APP_ID: ${{ vars.VITE_FIREBASE_APP_ID }}
      - name: Build production Pages artifact
        run: npm run build
        env:
          VITE_FIREBASE_API_KEY: ${{ vars.VITE_FIREBASE_API_KEY }}
          VITE_FIREBASE_AUTH_DOMAIN: ${{ vars.VITE_FIREBASE_AUTH_DOMAIN }}
          VITE_FIREBASE_PROJECT_ID: ${{ vars.VITE_FIREBASE_PROJECT_ID }}
          VITE_FIREBASE_STORAGE_BUCKET: ${{ vars.VITE_FIREBASE_STORAGE_BUCKET }}
          VITE_FIREBASE_MESSAGING_SENDER_ID: ${{ vars.VITE_FIREBASE_MESSAGING_SENDER_ID }}
          VITE_FIREBASE_APP_ID: ${{ vars.VITE_FIREBASE_APP_ID }}
      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v3
        with: { path: dist }
      - name: Deploy Pages
        id: deployment
        uses: actions/deploy-pages@v4

  smoke:
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    needs: deploy
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Setup Node
        uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - name: Install dependencies
        run: npm ci
      - name: Install Chromium
        run: npx playwright install --with-deps chromium
      - name: Run read-only deployment smoke
        run: npm run test:smoke -- --base-url "${{ needs.deploy.outputs.page_url }}"
      - name: Upload smoke evidence
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: production-smoke-artifacts
          path: |
            playwright-report/
            test-results/
          if-no-files-found: ignore
          retention-days: 14
```

- [ ] **Step 5: Run workflow/E2E contracts and a local read-only smoke**

Run:

```bash
node --test scripts/workflow-contract.test.mjs scripts/e2e-contract.test.mjs
npm run build
npm run preview -- --host 127.0.0.1 --port 4174
```

In another command session, run:

```bash
npm run test:smoke -- --base-url http://127.0.0.1:4174/ConanTCGMarket/
```

Expected: contracts pass, smoke passes without authentication or writes, and the preview process is stopped afterward.

- [ ] **Step 6: Commit the deployment gates**

```bash
git add .github/workflows/deploy.yml scripts/workflow-contract.test.mjs e2e/smoke.spec.ts
git commit -m "ci: gate github pages deployment with e2e"
```

### Task 11: Document operation, branch protection, limitations, and final verification

**Files:**
- Create: `docs/integration-testing.md`
- Modify: `scripts/e2e-contract.test.mjs`
- Local only: `TODO.md` (update progress but do not stage)

**Interfaces:**
- Produces the operator runbook for local/CI usage and the manual repository-settings checklist.

- [ ] **Step 1: Add a failing documentation contract**

Extend `scripts/e2e-contract.test.mjs`:

```js
test('documents local safety, CI gates, artifacts, and staging triggers', async () => {
  const guide = await readFile(new URL('../docs/integration-testing.md', import.meta.url), 'utf8');
  for (const text of [
    'demo-conan-tcg-e2e', 'npm run test:e2e', 'npm run test:e2e:webkit',
    'quality', 'rules', 'e2e', 'required checks', '14 days',
    'no production writes', 'composite indexes', 'Google OAuth',
    'Storage CORS', 'Functions IAM', 'real Gmail',
  ]) assert.ok(guide.includes(text), `documentation missing ${text}`);
});
```

Run: `node --test scripts/e2e-contract.test.mjs`

Expected: FAIL because the guide does not exist.

- [ ] **Step 2: Write the integration-testing runbook**

Document exact commands and expected ownership:

```markdown
# Integration and deployment testing

## Safety model
All automated browser and Rules tests use `demo-conan-tcg-e2e` and loopback
Emulators. They require no production Firebase/Gmail credentials and perform no
production writes.

## Local commands
- `npm run test:quality`
- `npm run test:rules`
- `npm run test:e2e:chromium`
- `npm run test:e2e:webkit`
- `npm run test:e2e`
- `npm run test:smoke -- --base-url <read-only-url>`

## GitHub repository settings
Mark `quality`, `rules`, and `e2e` as required checks for `main`. Require pull
requests if direct pushes must also be prevented; workflow YAML cannot enforce
that repository policy by itself.
```

Also document Node 22, Java 21, Playwright browser installation, ports, single-worker/retry behavior, report/log locations, 14-day CI artifacts, common port/Java/browser failures, post-deploy smoke/no rollback, and every staging trigger/safety control from the design spec.

- [ ] **Step 3: Run every fresh verification gate**

Run in this order and record exit codes:

```bash
npm ci
npm --prefix functions ci
npm run test:quality
npm run test:rules
npm run test:e2e:chromium
npm run test:e2e:webkit
npm run build
git diff --check
```

Expected: all commands exit `0`; Playwright reports no flaky retry-only pass; production build uses the developer's existing local `.env` only for this local build and E2E never uses it.

- [ ] **Step 4: Audit the requirements and safety boundaries**

Run:

```bash
rg -n "waitForTimeout|GMAIL_|conantcgmarket" e2e playwright.config.ts .env.e2e .github/workflows/deploy.yml
git status --short
git diff --cached --name-only
```

Expected:

- no `waitForTimeout` and no Gmail secret reference in E2E;
- production Firebase variables appear only in the deploy production-build step;
- `TODO.md` and the user's unrelated untracked files are not staged;
- the coverage matrix in the design maps to at least one named spec/test;
- smoke contains no mutating action.

- [ ] **Step 5: Commit documentation without `TODO.md`**

```bash
git add docs/integration-testing.md scripts/e2e-contract.test.mjs
git commit -m "docs: explain emulator integration gates"
```

- [ ] **Step 6: Perform a final branch review before integration**

Run:

```bash
git log --oneline --decorate -12
git diff main...HEAD --stat
git diff main...HEAD --check
```

Then use `superpowers:requesting-code-review`, address findings with TDD, rerun the full Step 3 gates, and use `superpowers:finishing-a-development-branch`. Do not push, merge, deploy, or change GitHub repository rules until the user explicitly authorizes that external action.
