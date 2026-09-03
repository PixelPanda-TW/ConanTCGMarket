# Batch 3 Account Access Foundation Implementation Plan

> **Required execution discipline:** implement each task in order with a witnessed RED test before production changes, make the smallest GREEN change, rerun the focused suite, and commit that task before continuing. Do not implement suspension administration, appeals, contact disclosure, or Listing hide/restore in this batch.

**Goal:** Add one live, server-enforced account-access state so Google-authenticated users are active buyers by default, completed Profiles add seller capability, and suspended users retain read-only access to approved history while every current privileged mutation is denied.

**Architecture:** `accountAccess/{uid}` is a server-owned Firestore document. A missing document is the backward-compatible active default. A strict domain/converter layer feeds a same-UID snapshot repository; `AuthProvider` composes that observer with Firebase Auth and exposes a discriminated access state. UI gates are fail-closed for private/action surfaces, while Firestore and Storage Rules remain the actual authorization boundary.

**Tech stack:** React 19, TypeScript, Vite, Firebase Auth/Firestore/Storage, Firebase Emulator Suite, Vitest, Testing Library, Playwright.

**Approved design:** `docs/superpowers/specs/2026-09-03-batch-3-account-access-foundation-design.md`

---

## Task 1: Strict Account Access Domain and Firestore Conversion

**Files:**

- Create: `src/domain/models/accountAccess.ts`
- Modify: `src/domain/models/index.ts`
- Modify: `src/domain/models/domainModels.test.ts`
- Modify: `src/data/firestore/converters.ts`
- Modify: `src/data/firestore/converters.test.ts`
- Modify: `src/data/firestore/paths.ts`

### RED

Add table-driven model tests proving:

- active and suspended records validate;
- violation counts must be finite, integral, and non-negative;
- active records reject suspension-only fields;
- suspended records require a trimmed non-empty reason, `suspendedAt`, and `suspendedBy`;
- UID/actor identifiers enforce 1–128 characters and reasons enforce 1–1000 characters;
- UID and `updatedAt` are required and valid.

Add converter tests proving:

- `accountAccessConverter.fromFirestore` maps Firestore timestamps to Dates and uses the snapshot ID as UID;
- active and suspended canonical documents are accepted;
- missing required, extra, malformed, or inconsistent fields throw;
- `toFirestore` emits only the canonical fields and converts Dates to timestamps.

Add a path assertion for `collections.accountAccess`.

Run:

```bash
npm test -- --run src/domain/models/domainModels.test.ts src/data/firestore/converters.test.ts
```

Expected: FAIL because the account model, converter, and collection path do not exist.

### GREEN

Implement:

- `AccountAccessStatus` and `AccountAccess`;
- a strict `validateAccountAccess` function with finite/integer/count and bounded-string checks;
- exact-field-shape checks in the converter, with separate allowed fields for active and suspended states;
- canonical serialization with no undefined fields;
- `collections.accountAccess = 'accountAccess'` and model barrel export.

Rerun the focused test command and require PASS. Run `npm run build:e2e` to catch type/export mistakes.

### Commit

```bash
git add src/domain/models/accountAccess.ts src/domain/models/index.ts src/domain/models/domainModels.test.ts src/data/firestore/converters.ts src/data/firestore/converters.test.ts src/data/firestore/paths.ts
git commit -m "feat: define account access records"
```

---

## Task 2: Same-UID Live Account Access Repository

**Files:**

- Create: `src/data/firestore/repositories/accountAccessRepository.ts`
- Create: `src/data/firestore/repositories/accountAccessRepository.test.ts`
- Modify: `src/data/firestore/repositories/index.ts`

### RED

Mock Firebase Auth/Firestore and add tests proving `subscribeAccountAccess`:

- rejects an empty UID;
- rejects when no Firebase user is signed in;
- rejects a UID different from `auth.currentUser.uid` before opening Firestore;
- subscribes only to `accountAccess/{uid}` with the strict converter;
- emits `null` for a missing snapshot;
- emits a converted active or suspended record for an existing snapshot;
- forwards listener errors unchanged;
- returns and preserves the Firestore unsubscribe function.

Run:

```bash
npm test -- --run src/data/firestore/repositories/accountAccessRepository.test.ts
```

Expected: FAIL because the repository does not exist.

### GREEN

Implement the smallest snapshot subscription using the existing configured `auth` and `db`, the account path constant, `withConverter(accountAccessConverter)`, and `onSnapshot`. Do not create or mutate documents and do not infer seller status.

Rerun the focused test and then the repository suites:

```bash
npm test -- --run src/data/firestore/repositories
```

### Commit

```bash
git add src/data/firestore/repositories/accountAccessRepository.ts src/data/firestore/repositories/accountAccessRepository.test.ts src/data/firestore/repositories/index.ts
git commit -m "feat: observe current account access"
```

---

## Task 3: Compose Authentication and Account Access State

**Files:**

- Modify: `src/features/auth/AuthProvider.tsx`
- Rewrite: `src/features/auth/AuthProvider.test.tsx`

### RED

Replace the shallow hook-mock test with a jsdom consumer harness that controls both observer callbacks. Cover:

- unresolved Auth starts `loading` and `isLoading=true`;
- signed out resolves to `signed-out` and inactive;
- signed in starts the matching access subscription and remains loading;
- missing access resolves active with `access:null`;
- an active document resolves active and a suspended document resolves suspended;
- access errors resolve `unavailable`, preserve the signed-in user, and fail closed;
- Auth and access errors remain distinguishable;
- UID changes unsubscribe the previous account observer;
- late callbacks from a prior UID and callbacks after unmount cannot overwrite current state;
- a live active-to-suspended update rerenders consumers without reload;
- sign-in and sign-out retain existing retryable error behavior.

Run:

```bash
npm test -- --run src/features/auth/AuthProvider.test.tsx
```

Expected: FAIL because the provider has no account observer or access state.

### GREEN

Export a discriminated `AccountAccessState`, extend `AuthState` with `accountAccessState` and `isActiveAccount`, and compose the observers with cleanup/generation protection. Keep `isLoading` true until both Auth and the first access result settle for a signed-in UID. Map missing access to active and read failures to unavailable without signing the user out.

Rerun the focused test and `npm run build:e2e`.

### Commit

```bash
git add src/features/auth/AuthProvider.tsx src/features/auth/AuthProvider.test.tsx
git commit -m "feat: expose live account access state"
```

---

## Task 4: Enforce Active-Account Mutations in Firebase Rules

**Files:**

- Modify: `firestore.rules`
- Modify: `storage.rules`
- Modify: `src/rules/firebaseRules.test.ts`

### RED

Expand Emulator Rules tests with server-seeded missing, active, suspended, and malformed access records. Prove:

- an authenticated user reads only its own access record;
- unauthenticated and other users cannot read it;
- no browser user, including its owner, can create/update/delete it;
- missing and explicit-active states permit every existing owner mutation: Profile, Listing create/update/delete, Sale create, and subscription create/update/delete;
- suspended and malformed-present states deny every one of those mutations;
- suspended owners can still read their own inactive Listings, Sales, and subscription history;
- public active Listing and Card reads remain unchanged;
- missing and active states permit owner image upload/delete;
- suspended and malformed-present states deny image upload/delete.

Run without loading the production `.env`:

```bash
npm run test:rules
```

Expected: FAIL because current Rules ignore `accountAccess` and expose no own-read rule.

### GREEN

Add a shared Firestore `isActiveAccount()` helper based on same-UID `accountAccess`, with missing-document active fallback and any non-`active` present value denied. Apply it only to current privileged writes while preserving approved reads. Add the equivalent cross-service Firestore lookup to Storage owner writes.

Rerun `npm run test:rules` and require PASS. Also run `npm test -- --run src/rules/firebaseRules.test.ts` only through the configured emulator command, not as a standalone Vitest invocation.

### Commit

```bash
git add firestore.rules storage.rules src/rules/firebaseRules.test.ts
git commit -m "feat: enforce active account mutations"
```

---

## Task 5: Shared Account-State Guidance and Global Navigation

**Files:**

- Create: `src/features/auth/AccountAccessNotice.tsx`
- Create: `src/features/auth/AccountAccessNotice.test.tsx`
- Modify: `src/features/auth/AuthStatus.tsx`
- Modify: `src/features/auth/AuthStatus.test.tsx`
- Modify: `src/styles.css`

### RED

Add accessibility-oriented component tests proving:

- suspended notice states that public Marketplace browsing remains possible;
- a sanitized bounded reason is shown only when available;
- unavailable notice gives refresh/retry guidance;
- status is announced without placing action controls inside an alert;
- active global status says `Google 帳號` rather than describing every account as a seller;
- only active users see Profile, Sell, Dashboard, and subscription links;
- suspended/unavailable users retain sign-out but no privileged navigation;
- signed-out and loading behavior remains intact.

Run:

```bash
npm test -- --run src/features/auth/AccountAccessNotice.test.tsx src/features/auth/AuthStatus.test.tsx
```

Expected: FAIL because state-specific UI does not exist.

### GREEN

Implement one reusable notice for suspended/unavailable states and update AuthStatus to branch on the provider state. Add minimal responsive/contrast/focus styling using existing tokens; do not invent admin or appeal controls.

Rerun focused tests and `npm run build:e2e`.

### Commit

```bash
git add src/features/auth/AccountAccessNotice.tsx src/features/auth/AccountAccessNotice.test.tsx src/features/auth/AuthStatus.tsx src/features/auth/AuthStatus.test.tsx src/styles.css
git commit -m "feat: present account access status"
```

---

## Task 6: Gate Profile Creation and Listing Creation

**Files:**

- Modify: `src/features/profile/SellerProfilePage.tsx`
- Modify: `src/features/profile/SellerProfilePage.test.tsx`
- Modify: `src/features/sell/SellPage.tsx`
- Modify: `src/features/sell/SellPage.test.tsx`

### RED

For each page, explicitly model active, suspended, unavailable, loading, and signed-out Auth states. Prove:

- suspended/unavailable Profile never calls `getSellerProfile`, never renders the form, and shows the account notice;
- suspended/unavailable Sell never calls `getSellerProfile` or `listCards`, never renders the Listing form, and cannot upload/create;
- provider loading remains a loading state;
- active users preserve Profile creation/edit behavior;
- active users without a Profile get setup guidance;
- active users with a Profile preserve canonical Card Master validation and Listing creation.

Run:

```bash
npm test -- --run src/features/profile/SellerProfilePage.test.tsx src/features/sell/SellPage.test.tsx
```

Expected: FAIL because signed-in users currently load and render regardless of access state.

### GREEN

Gate both effects and render branches on `accountAccessState.state === 'active'`. Reuse the shared notice and retain existing signed-out copy. Include account state in effect dependencies so a live suspension clears contextual form/private state and prevents stale promise results from rendering.

Rerun focused tests and `npm run build:e2e`.

### Commit

```bash
git add src/features/profile/SellerProfilePage.tsx src/features/profile/SellerProfilePage.test.tsx src/features/sell/SellPage.tsx src/features/sell/SellPage.test.tsx
git commit -m "feat: gate seller setup and listing creation"
```

---

## Task 7: Gate Listing Ownership Controls and Preserve Read-Only History

**Files:**

- Modify: `src/features/listings/ListingPage.tsx`
- Modify: `src/features/listings/ListingPage.test.tsx`
- Modify: `src/features/listings/ListingEditPage.tsx`
- Modify: `src/features/listings/ListingEditPage.test.tsx`
- Modify: `src/features/dashboard/DashboardPage.tsx`
- Modify: `src/features/dashboard/DashboardPage.test.tsx`

### RED

Add state-matrix tests proving:

- Listing detail remains publicly readable but its owner-management link requires the active state;
- suspended/unavailable direct edit routes show a non-editable notice and never call Listing/Profile/Card loading, uploads, updates, or deletes;
- active owner edit behavior remains intact;
- suspended Dashboard loads the current UID's Listings and Sales, shows active and sold-out/history data, includes the suspension reason, and has no edit, Sale-registration, or modal controls;
- unavailable Dashboard does not load private data;
- active Dashboard preserves all current controls and Sale flow;
- user/access transitions cannot reveal the previous UID's history or resurrect mutation controls.

Run:

```bash
npm test -- --run src/features/listings/ListingPage.test.tsx src/features/listings/ListingEditPage.test.tsx src/features/dashboard/DashboardPage.test.tsx
```

Expected: FAIL because controls depend only on UID and Dashboard has no read-only mode.

### GREEN

Thread account state through each surface. Require active access for ownership actions, short-circuit edit loaders when not active, and add a Dashboard read-only branch that preserves owner queries for suspended accounts but removes all mutation handlers/controls. Fail closed without private loads for unavailable state. Clear pending modal/action context on access-state transitions.

Rerun focused tests and `npm run build:e2e`.

### Commit

```bash
git add src/features/listings/ListingPage.tsx src/features/listings/ListingPage.test.tsx src/features/listings/ListingEditPage.tsx src/features/listings/ListingEditPage.test.tsx src/features/dashboard/DashboardPage.tsx src/features/dashboard/DashboardPage.test.tsx
git commit -m "feat: make suspended seller history read only"
```

---

## Task 8: Gate Buyer Subscription Surfaces

**Files:**

- Modify: `src/features/notifications/CardNameSubscriptionControl.tsx`
- Modify: `src/features/notifications/CardNameSubscriptionControl.test.tsx`
- Modify: `src/features/notifications/NotificationSettingsPage.tsx`
- Modify: `src/features/notifications/NotificationSettingsPage.test.tsx`

### RED

Add tests proving:

- active buyers preserve subscribe/unsubscribe and daily email behavior;
- suspended/unavailable users cannot open confirmation or invoke any subscription repository mutation;
- suspended/unavailable Notification Settings never loads subscription data and shows appropriate guidance;
- signed-out prompts and Auth loading behavior remain intact;
- a live active-to-suspended transition clears in-flight/local subscription UI and prevents stale results from appearing.

Run:

```bash
npm test -- --run src/features/notifications/CardNameSubscriptionControl.test.tsx src/features/notifications/NotificationSettingsPage.test.tsx
```

Expected: FAIL because subscription surfaces currently use authentication alone.

### GREEN

Require active account state before reads or mutations, reuse the account notice in the settings page, and reset generation-scoped local state when access changes. The compact Marketplace control may show concise non-actionable account guidance rather than the full page notice.

Rerun focused tests and `npm run build:e2e`.

### Commit

```bash
git add src/features/notifications/CardNameSubscriptionControl.tsx src/features/notifications/CardNameSubscriptionControl.test.tsx src/features/notifications/NotificationSettingsPage.tsx src/features/notifications/NotificationSettingsPage.test.tsx
git commit -m "feat: gate buyer subscriptions by account status"
```

---

## Task 9: Emulator Scenario Support and Browser Acceptance

**Files:**

- Modify: `e2e/support/emulator-state.ts`
- Modify: `e2e/support/emulator-state.spec.ts`
- Create: `e2e/account-access.spec.ts`
- Modify: `e2e/support/auth.ts`
- Modify as required: `e2e/support/fixtures.ts`

### RED

First add unit tests for canonical account-access seeding and timestamp conversion. Then add a Chromium scenario that:

- signs in with Google Emulator and has no access document, proving the existing buyer/Profile path still works;
- seeds a suspended access record for the signed-in UID plus owned active/sold-out Listings and Sale history;
- observes the live suspended global state without reload;
- continues to browse Marketplace and Listing detail;
- cannot see privileged global links or the Listing management link;
- receives blocked Profile, Sell, Listing edit, and Notification Settings screens;
- opens Dashboard history and sees no edit or Sale-registration actions.

Run the helper spec, then the new browser scenario through the script that starts the full Emulator set. Do not export production environment variables:

```bash
npm run build:functions
firebase emulators:exec --project demo-conan-tcg-e2e --only auth,firestore,storage,functions "playwright test --config playwright.config.ts --project chromium e2e/support/emulator-state.spec.ts"
firebase emulators:exec --project demo-conan-tcg-e2e --only auth,firestore,storage,functions "playwright test --config playwright.config.ts --project chromium e2e/account-access.spec.ts"
```

Expected: helper test initially FAIL before seed support, then browser test FAIL before all live UI wiring is correct.

### GREEN

Add `accountAccess?: readonly AccountAccess[]` to `ScenarioSeed` and serialize canonical timestamps with Firebase Admin. Implement only the approved scenario; do not add a UI or client helper that writes access documents.

Rerun both focused commands and require PASS.

### Commit

```bash
git add e2e/support/emulator-state.ts e2e/support/emulator-state.spec.ts e2e/account-access.spec.ts e2e/support/auth.ts e2e/support/fixtures.ts
git commit -m "test: cover suspended account access journey"
```

---

## Task 10: Update Operational Documentation and Complete Verification

**Files:**

- Modify: `docs/milestones.md`
- Modify: `docs/integration-verification.md`
- Modify if behavior is documented: `README.md`

### RED documentation check

Add documentation assertions or repository text checks only if the project already has a suitable docs test. Otherwise use explicit searches as the failing audit:

```bash
rg -n "賣家登入中|authenticated users only|accountAccess|suspended" README.md docs src/features/auth
```

Expected before update: account-access enforcement and its deliberate Listing-visibility deferral are absent or stale wording remains.

### GREEN

Document:

- Google sign-in as buyer validity and Profile completion as seller capability;
- missing access documents as active compatibility behavior;
- client self-read/server-only write policy;
- suspended read-only history and denied actions;
- contact disclosure, admin suspend/restore, appeals, and Listing hide/republish as later batches;
- exact emulator commands used to verify the boundary.

Do not claim suspension operations or contact privacy are complete.

Run final verification in this order:

```bash
source /Users/erinli/.nvm/nvm.sh
nvm use 22
set -a
source ../../.env
set +a
npm test -- --run
npm --prefix functions test
npm run build
```

Then open a clean shell that has not sourced production `.env` and run:

```bash
npm run test:rules
npx playwright test --project=chromium
git diff --check
git status -sb
```

Requirements:

- all frontend/unit suites pass;
- all Functions suites pass;
- Firestore and Storage Rules suites pass;
- all Chromium E2E suites pass;
- frontend build and Functions lint/build pass;
- no unexpected generated files or production-data changes exist;
- only the known Vite bundle-size warning is acceptable.

If any check fails, use systematic diagnosis, add a reproducing test when coverage is missing, and fix only Batch 3 scope before claiming completion.

### Commit

```bash
git add docs/milestones.md docs/integration-verification.md README.md
git commit -m "docs: record account access enforcement"
```

After the documentation commit, rerun `git status -sb`; it must be clean before beginning Batch 4.
