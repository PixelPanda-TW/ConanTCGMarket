# Batch 6 Admin Card Master Management Implementation Plan

> Execute every task test-first. Observe the focused test fail for the intended
> missing behavior before changing production code, then make the smallest
> implementation pass and commit that coherent task.

**Goal:** Provide an active-admin-only operational console and trusted API for
adding, editing, merging, and disabling Card Master records while keeping the
public Card schema stable and preserving historical Listing/Sale snapshots.

**Architecture:** Pure Functions domain handlers own normalization,
deterministic identity, authorization, concurrency, and atomic mutations.
Callable adapters use Admin Auth/Firestore. The frontend treats the custom
claim as navigation state only and uses strict callable repositories. Retired
keys live in server-only archives and suppress future controlled imports.

**Spec:** `docs/superpowers/specs/2026-09-04-batch-6-admin-card-master-design.md`

**Production safety:** Do not assign a production custom claim, deploy, invoke
production callables, or run a production Card import/apply. Emulator-only
claims and mutations are expected in Rules/E2E.

## Task 1: Define the pure admin Card Master domain

**Files:**

- Create: `functions/src/adminCardMaster.ts`
- Create: `functions/src/adminCardMaster.test.ts`

**Consumes:** Existing canonical Card fields, card-ID normalization rules, and
canonical active-account semantics.

**Produces:** Pure add/edit/disable/merge handlers, deterministic key and
fingerprint helpers, exact archive/audit values, and transactional ports.

1. Add failing table tests for exact request keys, supported types, NFC/trimmed
   name, four-digit/`Pddd` ID normalization, uppercase unique sorted rarities,
   1–500-code-point rationale, key format, and full source fingerprint.
2. Cover unauthenticated, false/string/missing admin claims, suspended and
   malformed access, missing access compatibility, malformed stored Card or
   archive, stale fingerprints, duplicate target keys, and dependency errors.
3. Prove add creates exactly one four-field Card and one audit event.
4. Prove same-key edit updates only four fields; identity edit atomically
   creates the replacement, archives/deletes the source, and audits both states.
5. Prove disable archives then removes only the active source.
6. Prove merge requires distinct live source/target fingerprints, unions only
   rarities into the unchanged target identity, archives/deletes only source,
   and audits both states.
7. Assert denied/conflicting paths call no mutation and no payload contains
   effect, image, email, contact, token, or Listing/Sale changes.
8. Run:

   ```sh
   npm --prefix functions test -- --run src/adminCardMaster.test.ts
   ```

   Expect module-not-found failure.
9. Implement the smallest port-driven handlers. Mirror the import normalizer;
   do not import repository-root scripts into the Functions artifact.
10. Rerun focused tests and Functions lint.
11. Commit:

   ```sh
   git add functions/src/adminCardMaster.ts functions/src/adminCardMaster.test.ts
   git commit -m "feat: define admin card master operations"
   ```

## Task 2: Expose protected callable Admin adapters

**Files:**

- Modify: `functions/src/index.ts`
- Modify: `functions/src/index.test.ts`

**Consumes:** Task 1 handlers.

**Produces:** `listCardMasterArchives`, `addCardMasterEntry`,
`editCardMasterEntry`, `disableCardMasterEntry`, and
`mergeCardMasterEntries` callable exports.

1. Add failing export/endpoint contract tests for the five callable names.
2. Add adapter seam tests proving custom claims and account access are passed
   into every mutation; reads/mutations stay inside one Admin transaction;
   FieldValue server timestamps are not client supplied; and archive listing is
   ordered, cursor-bounded, and limited to 100.
3. Prove unexpected failures become generic `unavailable`, domain codes are
   preserved, and logs do not contain request data, rationale, or before/after
   values.
4. Run focused tests and observe missing exports fail.
5. Implement Admin adapters and exact Timestamp/value conversion.
6. Run:

   ```sh
   npm --prefix functions test -- --run src/index.test.ts src/adminCardMaster.test.ts
   npm --prefix functions run lint
   npm run build:functions
   ```
7. Commit:

   ```sh
   git add functions/src/index.ts functions/src/index.test.ts
   git commit -m "feat: expose admin card master callables"
   ```

## Task 3: Suppress archived identities during controlled imports

**Files:**

- Modify: `scripts/import-card-master.mjs`
- Modify: `scripts/import-card-master.test.mjs`
- Modify: `scripts/card-master-domain.mjs`
- Modify: `scripts/card-master-domain.test.mjs`
- Modify if required: `docs/card-master-import.md`

**Consumes:** Existing deterministic key planner and Task 1 archive meaning.

**Produces:** Dry-run/apply plans that report and omit archived keys without
deleting any active or archive document.

1. Add failing pure tests for empty suppression, disabled/superseded/merged
   keys, duplicate archive keys, malformed archive fields/dispositions, and
   deterministic `suppressedKeys`/`suppressedCount` reporting.
2. Add CLI dependency tests proving archives are read before Admin writes,
   suppressed artifact entries never reach a batch, and an archive read or
   validation failure aborts before writes.
3. Preserve current upsert-only behavior: admin-created Cards absent from Rugia
   are never deleted.
4. Run focused script tests and observe suppression is ignored.
5. Implement an injected archive listing dependency and pure suppression
   planner. Do not change Rugia scraping fields or fetch effects/images.
6. Run focused then all script tests.
7. Commit:

   ```sh
   git add scripts/import-card-master.mjs scripts/import-card-master.test.mjs scripts/card-master-domain.mjs scripts/card-master-domain.test.mjs docs/card-master-import.md
   git commit -m "fix: preserve retired card master identities"
   ```

## Task 4: Add strict frontend admin Card adapters

**Files:**

- Create: `src/domain/models/cardMasterArchive.ts`
- Modify: `src/domain/models/index.ts`
- Modify: `src/domain/models/domainModels.test.ts`
- Create: `src/data/firestore/repositories/adminCardMasterRepository.ts`
- Create: `src/data/firestore/repositories/adminCardMasterRepository.test.ts`
- Modify: `src/data/firestore/repositories/index.ts`

**Consumes:** Task 2 callable wire contracts.

**Produces:** Strict archive/page/result readers and callable functions for all
five admin operations.

1. Add failing tests for exact callable names/payloads and canonical responses.
2. Reject extra/missing fields, invalid card keys/fingerprints, partial archive
   dispositions, invalid timestamps, oversized pages, unsafe cursors, and
   effect/image/contact/token fields.
3. Add source assertions proving no browser Firestore mutation is imported.
4. Run focused tests and observe missing module failure.
5. Implement strict adapters. Return canonical values and surface callable
   error codes unchanged for UI handling.
6. Run focused then full frontend tests with intended test config.
7. Commit:

   ```sh
   git add src/domain/models/cardMasterArchive.ts src/domain/models/index.ts src/domain/models/domainModels.test.ts src/data/firestore/repositories/adminCardMasterRepository.ts src/data/firestore/repositories/adminCardMasterRepository.test.ts src/data/firestore/repositories/index.ts
   git commit -m "feat: add admin card master adapters"
   ```

## Task 5: Resolve the admin claim without changing ordinary account access

**Files:**

- Modify: `src/features/auth/authService.ts`
- Modify: `src/features/auth/authService.test.ts`
- Modify: `src/features/auth/AuthProvider.tsx`
- Modify: `src/features/auth/AuthProvider.test.tsx`
- Modify: `src/features/auth/AuthStatus.tsx`
- Modify: `src/features/auth/AuthStatus.test.tsx`

**Consumes:** Firebase Google identity and current account-access context.

**Produces:** `adminAccessState` (`loading`, `admin`, `not-admin`,
`unavailable`) and an admin-only navigation link.

1. Add failing tests for exact boolean claim handling, auth changes, stale
   promise invalidation, claim refresh, lookup failure, suspension, and logout.
2. Prove claim failure does not change buyer/seller account state or remove
   normal navigation.
3. Assert `管理卡片資料` is present only for active `admin` state.
4. Run focused tests and observe the missing state/link fail.
5. Implement one token-result lookup per authenticated identity transition,
   with request tokens matching existing provider race handling.
6. Run focused tests and commit.

   ```sh
   git add src/features/auth/authService.ts src/features/auth/authService.test.ts src/features/auth/AuthProvider.tsx src/features/auth/AuthProvider.test.tsx src/features/auth/AuthStatus.tsx src/features/auth/AuthStatus.test.tsx
   git commit -m "feat: resolve active admin navigation"
   ```

## Task 6: Build the protected Card Master console and add/edit flow

**Files:**

- Modify: `src/route.ts`
- Modify: `src/route.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Create: `src/features/admin/CardMasterAdminPage.tsx`
- Create: `src/features/admin/CardMasterAdminPage.test.tsx`
- Create: `src/features/admin/cardMasterAdminForm.ts`
- Create: `src/features/admin/cardMasterAdminForm.test.ts`
- Modify: `src/styles.css`

**Consumes:** Tasks 4–5.

**Produces:** Protected route, claim states, active/archive search, add, and
edit/rekey interactions.

1. Add failing route/App tests for `#/admin/cards` and direct signed-out,
   loading, non-admin, unavailable, suspended, and active-admin states.
2. Add failing pure form tests mirroring server validation without claiming UI
   validation is authorization.
3. Add component tests for prefix filtering by type/name/ID/rarity, add/edit
   field binding, multiple rarities, required rationale, exact repository
   payload, pending guard, canonical response adoption, stale reload guidance,
   and active/archive separation.
4. Add accessibility tests for labels, heading hierarchy, live regions, focus
   return, keyboard dialog dismissal, token focus styles, and narrow layout.
5. Observe focused failures, then implement using existing PageShell/FormField
   and theme tokens.
6. Run focused tests, production build, and commit.

   ```sh
   git add src/route.ts src/route.test.ts src/App.tsx src/App.test.tsx src/features/admin/CardMasterAdminPage.tsx src/features/admin/CardMasterAdminPage.test.tsx src/features/admin/cardMasterAdminForm.ts src/features/admin/cardMasterAdminForm.test.ts src/styles.css
   git commit -m "feat: add protected card master console"
   ```

## Task 7: Add merge and disable administration flows

**Files:**

- Modify: `src/features/admin/CardMasterAdminPage.tsx`
- Modify: `src/features/admin/CardMasterAdminPage.test.tsx`
- Modify: `src/features/admin/cardMasterAdminForm.ts`
- Modify: `src/features/admin/cardMasterAdminForm.test.ts`
- Modify: `src/styles.css`

**Consumes:** Task 6 console and Task 4 adapters.

**Produces:** Searchable merge target dialog and confirmed disable flow.

1. Add failing tests for source exclusion, target search, source/target summary,
   union preview, rationale, explicit confirmation, cancel/focus return,
   pending duplicate prevention, success adoption/archive display, and stale
   failure with no optimistic removal.
2. Prove merge/disable controls never appear outside active-admin state and
   historical Listing/Sale state is never requested or mutated.
3. Run focused tests, implement the smallest state machine, and rerun.
4. Commit:

   ```sh
   git add src/features/admin/CardMasterAdminPage.tsx src/features/admin/CardMasterAdminPage.test.tsx src/features/admin/cardMasterAdminForm.ts src/features/admin/cardMasterAdminForm.test.ts src/styles.css
   git commit -m "feat: manage retired card master entries"
   ```

## Task 8: Protect admin collections in Firestore Rules

**Files:**

- Modify: `firestore.rules`
- Modify: `src/rules/firebaseRules.test.ts`

**Consumes:** Server-only archive/audit architecture.

**Produces:** Explicit deny boundaries for admin operational collections.

1. Add failing Emulator tests proving guests, ordinary authenticated users,
   and `admin: true` browser clients cannot read/write archives or audit logs.
2. Reprove public Card reads and universal browser Card write denial.
3. Add explicit collection matches denying access; do not expose custom-claim
   shortcuts in Rules.
4. Run `npm run test:rules`, then focused public Card repository tests.
5. Commit:

   ```sh
   git add firestore.rules src/rules/firebaseRules.test.ts
   git commit -m "security: isolate card master administration data"
   ```

## Task 9: Prove admin Card operations in Chromium E2E

**Files:**

- Create: `e2e/card-master-admin.spec.ts`
- Modify: `e2e/support/auth.ts`
- Modify: `e2e/support/auth.spec.ts`
- Modify: `e2e/support/emulator-state.ts`
- Modify: `e2e/support/emulator-state.spec.ts`
- Modify if required: `e2e/public-marketplace.spec.ts`

**Consumes:** Tasks 2–8.

**Produces:** Browser + Auth/Firestore/Functions Emulator evidence.

1. Add safe support for setting an Emulator-only custom claim; assert the
   helper rejects every non-demo/non-loopback environment.
2. Add E2E cases proving ordinary users/direct routes have no console access
   and an active admin sees the navigation entry.
3. Trace add → edit/rekey → merge → disable through the UI. Verify exact active
   Card, archive, and audit documents after each operation; verify stale
   concurrency and direct browser writes are rejected.
4. Seed a historical Listing/Sale for a retired Card and prove its snapshot is
   unchanged while public Card search stops offering the retired identity.
5. Prove effect/image fields never appear in the form or stored documents.
6. Run the focused Chromium file through fixed demo Emulators, repair only
   selector/support issues, and rerun green.
7. Commit:

   ```sh
   git add e2e/card-master-admin.spec.ts e2e/support/auth.ts e2e/support/auth.spec.ts e2e/support/emulator-state.ts e2e/support/emulator-state.spec.ts e2e/public-marketplace.spec.ts
   git commit -m "test: verify card master administration end to end"
   ```

## Task 10: Document admin claim and release operations

**Files:**

- Modify: `docs/firebase-setup.md`
- Modify: `docs/card-master-import.md`
- Modify: `docs/milestones.md`
- Modify: `functions/src/index.test.ts`
- Modify: `scripts/package-contract.test.mjs`

1. Add failing documentation contracts for callable names, server-only
   collections, archive suppression, claim prerequisites, no-public-page
   language, release order, monitoring, rollback, and non-invasive checks.
2. Document a claim-inspection/assignment command as prohibited until separate
   approval; do not execute it or embed a real UID/email.
3. Document Functions → Rules → frontend ordering, followed by admin smoke only
   in the demo Emulator. Production verification must not add/edit/merge/
   disable a real card.
4. Mark Batch 6 repository-ready, not production-live.
5. Run focused contracts and commit:

   ```sh
   git add docs/firebase-setup.md docs/card-master-import.md docs/milestones.md functions/src/index.test.ts scripts/package-contract.test.mjs
   git commit -m "docs: add card master admin runbook"
   ```

## Task 11: Verify Batch 6 end to end

1. Use Node 22 and the intended local frontend environment only. Never source a
   production credential environment for Emulator tests.
2. Run:

   ```sh
   npm test
   npm run test:scripts
   npm run test:functions
   npm --prefix functions run lint
   npm run build:functions
   npm run test:rules
   npm run build:e2e
   npm run test:e2e:chromium
   npm run build
   git diff --check
   git status -sb
   ```
3. Scan all Card Master mutations, archives, audits, custom claims, and importer
   paths. Confirm browser writes remain impossible and only active `cards`
   records reach public application workflows.
4. Map every spec acceptance criterion to unit, adapter, Rules, or E2E evidence.
   Add a failing regression test for any missing evidence and repeat RED →
   GREEN.
5. Record totals, warnings, commits, and explicitly state that no production
   claim, deploy, callable, import, or data mutation occurred before Batch 7.
