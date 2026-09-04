# Batch 4 Secure Contact Disclosure Implementation Plan

> **Required execution discipline:** complete tasks in order. For every task, add the stated test first, run it and preserve a genuine RED caused by the missing behavior, then make the smallest production change, rerun to GREEN, and commit before moving on. Do not deploy, run migration apply mode, or mutate production data.

**Goal:** Remove contact details from public seller data and reveal them only after a deliberate Listing-page request by a currently authenticated, active account, through audited and rate-limited callable Functions.

**Architecture:** Firestore `sellerProfiles` becomes strict public presentation data while `sellerContacts` is server-only. Active-account callable Functions atomically save/read an owner's composite profile and reveal contact only by active Listing ID. The browser directly reads only the public profile, strictly validates callable responses, and holds a reveal only in component memory. Firestore Rules deny all client access to contacts, logs, counters, and profile writes. A dry-run-first migration prepares existing data without being executed against production in this batch.

**Tech stack:** React 19, TypeScript, Vite, Firebase Auth/Firestore/Functions, Firebase Admin/Cloud Functions v2, Firebase Emulator Suite, Vitest, Testing Library, Playwright, Node test runner.

**Approved design:** `docs/superpowers/specs/2026-09-04-batch-4-secure-contact-disclosure-design.md`

---

## Task 1: Split Public Profile and Private Contact Domain Shapes

**Files:**

- Modify: `src/domain/models/sellerProfile.ts`
- Modify: `src/domain/models/index.ts`
- Modify: `src/domain/models/domainModels.test.ts`
- Modify: `src/data/firestore/converters.ts`
- Modify: `src/data/firestore/converters.test.ts`
- Modify: `src/data/firestore/paths.ts`

### RED

Add table-driven tests proving:

- `PublicSellerProfile` validates UID, a trimmed 1–80-character display name, valid dates, and exact public semantics;
- `SellerContact` validates UID, canonical Batch 2 contact data, and valid dates;
- composite `SellerProfile` still validates both halves and applies the display-name bound;
- `publicSellerProfileConverter` writes/reads only display name and timestamps and rejects stored contact/unknown fields;
- no browser converter serializes a private contact;
- collection paths include `sellerContacts`, both limit collections, and access logs.

Run:

```bash
npm test -- --run src/domain/models/domainModels.test.ts src/data/firestore/converters.test.ts
```

Expected: FAIL because the split models/converter/paths do not exist and the old converter still includes contact fields.

### GREEN

Implement strict public/contact validators, retain the composite type for own application flows, replace `sellerProfileConverter` with `publicSellerProfileConverter`, and add the collection names. Keep private contact serialization out of browser code.

Rerun the focused tests. The full client type/build check is intentionally deferred to Task 4, where the repository switches from the removed composite Firestore converter to the callable boundary; Tasks 1–3 are a committed cross-layer schema transition and must not preserve a contact-bearing browser converter merely to make the intermediate tree type-check.

### Commit

```bash
git add src/domain/models/sellerProfile.ts src/domain/models/index.ts src/domain/models/domainModels.test.ts src/data/firestore/converters.ts src/data/firestore/converters.test.ts src/data/firestore/paths.ts
git commit -m "refactor: split public seller profiles from contacts"
```

---

## Task 2: Implement Pure Secure Profile and Disclosure Logic

**Files:**

- Create: `functions/src/sellerProfiles.ts`
- Create: `functions/src/sellerProfiles.test.ts`

### RED

Define dependency-injected handler tests covering:

- exact callable input allowlists, display-name bounds, and all four server-side contact normalizations;
- unauthenticated, missing-active, canonical-active, suspended, and malformed access records;
- atomic public/private save input with preserved valid creation times and one update time;
- own-profile `null` for no profile and incomplete/malformed pairs, plus canonical combined output for a valid pair;
- disclosure derives seller only from a trimmed bounded Listing ID and requires active status plus positive stock;
- missing/inactive/sold-out/malformed Listing/profile/contact produces one generic not-found result;
- requester limit 60/hour and seller limit 300/hour, exact boundary behavior, and UTC rollover;
- revealed/rate-limited/unavailable audits contain no contact data;
- responses contain only documented fields and epoch-millisecond dates.

Run:

```bash
npm --prefix functions test -- --run src/sellerProfiles.test.ts
```

Expected: FAIL because the secure profile module does not exist.

### GREEN

Implement pure validation, canonicalization, error classes/codes, UTC bucket derivation, and dependency-injected `save`, `getOwn`, and `reveal` handlers. Keep Firebase Admin imports out of this module so transactions and failure paths are deterministic in unit tests.

Rerun the focused Function test and Functions lint.

### Commit

```bash
git add functions/src/sellerProfiles.ts functions/src/sellerProfiles.test.ts
git commit -m "feat: define secure seller profile workflows"
```

---

## Task 3: Wire Callable Functions to Firestore Transactions

**Files:**

- Modify: `functions/src/index.ts`
- Modify: `functions/src/index.test.ts`

### RED

Extend the deployment-contract test to require exactly three new v2 callable exports:

- `saveSellerProfile`;
- `getOwnSellerProfile`;
- `getSellerContact`.

Assert callable endpoints are not public HTTP/operator handlers and do not carry permissive invoker configuration. Add adapter seam tests where practical for exact Firestore collection names and `HttpsError` code translation.

Run:

```bash
npm --prefix functions test -- --run src/index.test.ts
```

Expected: FAIL because the callables are not exported.

### GREEN

Create `onCall` adapters using the existing initialized Admin Firestore instance. Implement:

- exact active-account reads;
- transactional public/private profile writes;
- composite own reads;
- one disclosure transaction for Listing/profile/contact/counters/revealed log;
- separate no-contact audit writes for rate-limited and unavailable authenticated outcomes;
- server timestamps and random log IDs;
- stable mapping from domain errors to `HttpsError` without leaking private record state.

Rerun the focused test, full Functions suite, lint, and build.

### Commit

```bash
git add functions/src/index.ts functions/src/index.test.ts
git commit -m "feat: expose protected seller contact callables"
```

---

## Task 4: Replace Client Profile Persistence with Strict Callable Boundaries

**Files:**

- Modify: `src/data/firestore/repositories/sellerProfileRepository.ts`
- Modify: `src/data/firestore/repositories/sellerProfileRepository.test.ts`
- Modify: `src/data/firestore/repositories/index.ts`
- Modify: `src/features/profile/profileForm.ts`
- Modify: `src/features/profile/profileForm.test.ts`

### RED

Add tests proving:

- public profile reads use only `publicSellerProfileConverter` and return no contact;
- own load calls `getOwnSellerProfile` with `{}` only after same-UID assertion;
- save calls `saveSellerProfile` with only display/contact values, ignores client timestamps as authority, and returns the strict server profile;
- `getSellerContact` sends only Listing ID and rejects empty IDs;
- every callable response rejects extra/missing/malformed fields, bad dates, or noncanonical contact;
- profile form rejects a display name over 80 characters.

Run:

```bash
npm test -- --run src/data/firestore/repositories/sellerProfileRepository.test.ts src/features/profile/profileForm.test.ts
```

Expected: FAIL because the repository directly reads/writes the old public document and has no disclosure callable.

### GREEN

Use modular `httpsCallable(functionsClient, ...)`, exact runtime response guards, the strict public converter, and same-UID assertions. Change `saveSellerProfile` to return the authoritative server composite profile and add the client display-name bound.

Rerun the focused tests and `npm run build:e2e`.

### Commit

```bash
git add src/data/firestore/repositories/sellerProfileRepository.ts src/data/firestore/repositories/sellerProfileRepository.test.ts src/data/firestore/repositories/index.ts src/features/profile/profileForm.ts src/features/profile/profileForm.test.ts
git commit -m "feat: use protected seller profile callables"
```

---

## Task 5: Preserve Profile Editing and Seller Completeness

**Files:**

- Modify: `src/features/profile/SellerProfilePage.tsx`
- Modify: `src/features/profile/SellerProfilePage.test.tsx`
- Modify: `src/features/sell/SellPage.test.tsx`

### RED

Add component tests proving:

- Profile sends canonical form values but adopts returned UID/timestamps/contact as its saved state;
- a save failure keeps the form editable and does not report success;
- stale saves cannot cross user/unmount boundaries;
- Sell unlocks only for a complete composite callable result and handles rejected/incomplete loads as before;
- suspended/unavailable pages make no profile callable.

Run:

```bash
npm test -- --run src/features/profile/SellerProfilePage.test.tsx src/features/sell/SellPage.test.tsx
```

Expected: FAIL because Profile currently invents timestamps and expects a void save.

### GREEN

Adopt the returned profile after save and keep all Batch 3 account-state guards. Do not add a second seller-role flag.

Rerun the focused tests and `npm run build:e2e`.

### Commit

```bash
git add src/features/profile/SellerProfilePage.tsx src/features/profile/SellerProfilePage.test.tsx src/features/sell/SellPage.test.tsx
git commit -m "fix: preserve seller profile flows after contact split"
```

---

## Task 6: Add Deliberate Authenticated Contact Reveal UI

**Files:**

- Modify: `src/features/listings/ListingPage.tsx`
- Modify: `src/features/listings/ListingPage.test.tsx`
- Modify: `src/styles.css`

### RED

Build the Listing contact-state matrix tests:

- no contact value/link or endpoint call during public page load;
- signed-out action calls existing `signIn` and keeps the same hash route;
- active click calls `getSellerContact(listingId)` once and renders LINE/Discord text or Facebook/Threads safe links;
- loading disables duplicate requests;
- suspended/unavailable/auth-loading states have no reveal call;
- generic, rate-limit, and retry states disclose no partial data;
- a UID, account-state, or Listing-ID change immediately clears revealed data;
- stale promise resolution cannot reveal data on a new identity/Listing;
- seller public display name remains independently visible.

Run:

```bash
npm test -- --run src/features/listings/ListingPage.test.tsx
```

Expected: FAIL because contact is currently loaded publicly and automatically.

### GREEN

Load only the public profile, implement the memory-only state machine and stale-request generation guard, reuse `AccountAccessNotice` where appropriate, and add only the minimal button/status styling needed for existing responsive layouts.

Rerun the focused test and `npm run build:e2e`.

### Commit

```bash
git add src/features/listings/ListingPage.tsx src/features/listings/ListingPage.test.tsx src/styles.css
git commit -m "feat: reveal seller contacts to active accounts"
```

---

## Task 7: Deny Direct Contact and Profile Mutation in Rules

**Files:**

- Modify: `firestore.rules`
- Modify: `src/rules/firebaseRules.test.ts`

### RED

Update Emulator fixtures to split public/private data and add tests proving:

- anonymous and signed-in users can read strict public profiles;
- public profiles containing legacy contact/extra fields are not accepted as the target post-migration shape where Rules can enforce it;
- anonymous, active owner, other active user, suspended user, and malformed-access user all fail direct reads/writes of `sellerContacts`;
- every browser write to `sellerProfiles` fails;
- logs and both limit collections deny all reads/writes;
- all unrelated Batch 3 Listing/Sale/subscription behavior remains unchanged.

Run:

```bash
npm run test:rules
```

Expected: FAIL because owners can still write public profiles and server-only contact collections have no explicit test contract.

### GREEN

Make profile writes false and add explicit deny blocks for contacts/logs/limits. Keep public profile reads and existing account/listing rules intact.

Rerun Rules tests.

### Commit

```bash
git add firestore.rules src/rules/firebaseRules.test.ts
git commit -m "security: deny browser access to seller contacts"
```

---

## Task 8: Add a Dry-Run-First Contact Migration

**Files:**

- Create: `scripts/migrate-seller-contacts.mjs`
- Create: `scripts/migrate-seller-contacts.test.mjs`
- Modify: `package.json`

### RED

Use injected in-memory records and temporary backup paths to prove:

- default execution is dry-run and performs no writes;
- apply requires explicit project ID, `--apply`, and a non-existing backup path;
- malformed/noncanonical/extra-field legacy profiles abort before writes;
- matching existing contacts are idempotent while conflicting contacts abort;
- backup is written before any mutation and includes all source documents;
- private contacts are written and verified before public contact fields are removed;
- post-write count/value mismatch aborts public cleanup;
- batching is bounded and rerunning a successful migration is a no-op;
- production-looking project IDs receive no implicit authorization.

Run:

```bash
node --test scripts/migrate-seller-contacts.test.mjs
```

Expected: FAIL because the migration does not exist.

### GREEN

Implement a pure migration planner/executor plus a narrow Admin SDK CLI entrypoint. Add `migrate:seller-contacts` to package scripts. Never invoke `--apply` during this batch.

Rerun the focused script test and `npm run test:scripts`.

### Commit

```bash
git add scripts/migrate-seller-contacts.mjs scripts/migrate-seller-contacts.test.mjs package.json
git commit -m "feat: add safe seller contact migration"
```

---

## Task 9: Update Emulator Fixtures and End-to-End Privacy Coverage

**Files:**

- Modify: `e2e/support/emulator-state.ts`
- Modify: `e2e/support/emulator-state.spec.ts`
- Modify: `e2e/support/fixtures.ts`
- Modify: `e2e/auth-profile.spec.ts`
- Modify: `e2e/listing-lifecycle.spec.ts`
- Modify: `e2e/mvp-journey.spec.ts`
- Modify: `e2e/mobile-forms.spec.ts`
- Create: `e2e/contact-disclosure.spec.ts`

### RED

Split E2E profile/contact seeding and add Chromium journeys proving:

- an anonymous Listing contains display name but not the seeded contact string or link;
- clicking the signed-out action signs in without changing the Listing route, then a deliberate reveal succeeds;
- text and URL contact presentations follow Batch 2 semantics;
- suspended users cannot reveal;
- direct client Firestore contact reads fail;
- Profile create/edit persists both halves via Functions and still unlocks Sell.

Run the new focused Playwright spec through `firebase emulators:exec` with Auth, Firestore, Storage, and Functions.

Expected: FAIL until fixtures and application use the split schema/callables end to end.

### GREEN

Update only emulator fixtures and test expectations necessary for the strict split schema. Do not add production compatibility fallback.

Rerun the focused spec, then all Chromium E2E tests.

### Commit

```bash
git add e2e/support/emulator-state.ts e2e/support/emulator-state.spec.ts e2e/support/fixtures.ts e2e/auth-profile.spec.ts e2e/listing-lifecycle.spec.ts e2e/mvp-journey.spec.ts e2e/mobile-forms.spec.ts e2e/contact-disclosure.spec.ts
git commit -m "test: verify seller contact privacy end to end"
```

---

## Task 10: Document Release and Operational Verification

**Files:**

- Modify: `docs/firebase-setup.md`
- Modify: `functions/src/index.test.ts`
- Modify: `scripts/package-contract.test.mjs`

### RED

Add documentation contract assertions requiring:

- the exact contact split rollout order;
- migration dry-run and separately authorized apply commands;
- backup/non-overwrite/conflict/post-write verification requirements;
- 60 requester / 300 seller UTC-hour limits and all server-only collection names;
- non-invasive production verification that creates no Listing/Profile/contact and reveals no real contact;
- explicit statement that this branch does not deploy or migrate production.

Run:

```bash
npm --prefix functions test -- --run src/index.test.ts
node --test scripts/package-contract.test.mjs
```

Expected: FAIL because the setup guide does not document this workflow.

### GREEN

Document local/emulator use, release sequencing, rollback/backup retention, log/limit monitoring, and privacy verification. Do not run deployment or migration apply commands.

Rerun the focused tests.

### Commit

```bash
git add docs/firebase-setup.md functions/src/index.test.ts scripts/package-contract.test.mjs
git commit -m "docs: add secure contact rollout runbook"
```

---

## Task 11: Batch Verification and Boundary Audit

### Verification

Use Node 22. Run:

```bash
npm test
npm run test:scripts
npm run test:functions
npm --prefix functions run lint
npm run build:functions
npm run test:rules
npm run build:e2e
npm run test:e2e:chromium
set -a && source ../../.env && set +a && npm run build
git diff --check
git status -sb
```

Also search for forbidden public contact access:

```bash
rg -n "contactType|contactValue|sellerContacts|getSellerContact" src firestore.rules storage.rules functions/src scripts e2e
```

Manually confirm from results that:

- no public converter/document response includes contact;
- no Listing load automatically calls the disclosure endpoint;
- all own/contact callable paths enforce current active account server-side;
- all browser Rules deny contact and operational collections;
- migration apply mode was never executed;
- no production deployment/data mutation occurred.

If verification requires a correction, first add or tighten a regression test, witness RED, make the smallest fix, rerun the relevant focused/full suites, and commit it separately.

### Final batch status

Record the commits, exact test totals, any environmental warnings, and remaining deferred scope before beginning Batch 5. Do not claim production privacy migration is live; report only repository readiness.
