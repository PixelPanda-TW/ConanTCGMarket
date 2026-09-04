# Batch 5 Trusted Listing Lifecycle Implementation Plan

> Execute every task test-first. Observe the focused test fail for the intended
> missing behavior before changing production code, then make the smallest
> implementation pass and commit that coherent task.

**Goal:** Move Sale/inventory mutations behind trusted Functions, preserve
immutable card snapshots, keep sold-out Listings seller-visible, and render the
seller's complete Sale history.

**Architecture:** Pure lifecycle handlers own validation and decisions; callable
adapters map them to Admin Firestore transactions; browser repositories are
strict callable/read adapters. Firestore Rules deny browser mutation of existing
Listings and all Sale writes. Legacy Sales remain readable while new Sales are
strict snapshot records.

**Spec:** `docs/superpowers/specs/2026-09-04-batch-5-trusted-listing-lifecycle-design.md`

**Production safety:** Do not deploy, invoke production callables, or run a Sale
backfill with `--apply`. Emulator-only mutations are expected during Rules/E2E.

## Task 1: Define immutable Sale snapshots and history presentation

**Files:**

- Modify: `src/domain/models/sale.ts`
- Modify: `src/domain/models/domainModels.test.ts`
- Modify: `src/data/firestore/converters.ts`
- Modify: `src/data/firestore/converters.test.ts`
- Create: `src/features/dashboard/salesHistory.ts`
- Create: `src/features/dashboard/salesHistory.test.ts`

**Consumes:** Existing `CardType`, Listing metadata resolution, Sale converter.

**Produces:** Strict current Sale writes, explicit recognized-legacy reads,
deterministic history sorting/presentation for later UI.

1. Add failing tests proving:
   - normalized Sales require canonical `cardType`, trimmed `cardName`, and
     trimmed `rarity` together;
   - current converter writes exactly identity, snapshot, quantity/price, and
     timestamp fields;
   - the exact seven-field legacy persisted shape remains readable;
   - partial snapshots, unknown fields, invalid numbers/dates, and guessed
     character metadata fail closed;
   - history sorts `soldAt` descending then ID descending;
   - current snapshots win, recognized legacy metadata resolves only when
     unambiguous, and unavailable metadata stays explicitly unavailable;
   - line totals use actual sold price.
2. Run:

   ```sh
   npm test -- src/domain/models/domainModels.test.ts src/data/firestore/converters.test.ts src/features/dashboard/salesHistory.test.ts
   ```

   Expect failure for missing snapshot fields/helpers.
3. Implement the logical optional snapshot fields with a strict invariant:
   either all three exist and validate, or none exist only on recognized legacy
   reads. Keep write conversion current-only and use a dedicated legacy reader
   branch based on exact stored keys.
4. Implement pure deterministic history helpers without locale-dependent test
   expectations; inject/return Dates and format only at the component boundary.
5. Rerun the focused tests, then `git diff --check`.
6. Commit:

   ```sh
   git add src/domain/models/sale.ts src/domain/models/domainModels.test.ts src/data/firestore/converters.ts src/data/firestore/converters.test.ts src/features/dashboard/salesHistory.ts src/features/dashboard/salesHistory.test.ts
   git commit -m "feat: preserve sale identity snapshots"
   ```

## Task 2: Implement pure trusted lifecycle handlers

**Files:**

- Create: `functions/src/listingLifecycle.ts`
- Create: `functions/src/listingLifecycle.test.ts`

**Consumes:** Batch 3 active-account semantics and persisted Listing/Sale shapes.

**Produces:** Pure `handleRecordListingSale`, `handleUpdateSellerListing`, and
`handleDeleteUnsoldListing` plus port interfaces for the Admin adapter.

1. Write table-driven failing tests for exact input keys and scalar bounds.
2. Cover authentication, missing/canonical-active/suspended/malformed access,
   missing/malformed Listing, owner mismatch, inactive/sold-out state,
   overselling, stale version, and dependency failure.
3. Prove a partial Sale response has the exact snapshot/arithmetic fields and a
   sold-out Sale returns zero/`sold_out`; use one injected clock value.
4. Prove update writes only editable fields, preserves every immutable field,
   ignores no unknown key, rejects inventory/status inputs, and returns a
   canonical Listing.
5. Prove deletion requires active unsold inventory, a matching version, and no
   Sale; denied paths return no image URL and call no mutation.
6. Prove no input or output can contain contact data.
7. Run:

   ```sh
   npm --prefix functions test -- --run src/listingLifecycle.test.ts
   ```

   Expect module-not-found failure.
8. Implement error codes and the smallest port-driven transaction handlers.
   Mirror, do not import, frontend validation because Functions is an independent
   deployment artifact. Use exact object-key checks at every trust boundary.
9. Rerun focused tests and Functions lint.
10. Commit:

   ```sh
   git add functions/src/listingLifecycle.ts functions/src/listingLifecycle.test.ts
   git commit -m "feat: define trusted listing lifecycle"
   ```

## Task 3: Expose Admin Firestore callable transactions

**Files:**

- Modify: `functions/src/index.ts`
- Modify: `functions/src/index.test.ts`

**Consumes:** Task 2 handlers/ports.

**Produces:** Callable exports and real Admin transaction adapters.

1. Add failing manifest/source-contract tests for exactly these additional
   exports: `recordListingSale`, `updateSellerListing`,
   `deleteUnsoldListing`.
2. Add adapter seams/tests proving:
   - account access and Listing reads are inside the transaction;
   - Sale IDs are server-created and Sale + Listing write together;
   - Sale existence query for deletion is limited to one;
   - update writes an allowlist only;
   - Timestamp/Date conversion is strict;
   - domain errors become matching `HttpsError` codes and unexpected failures
     become generic `unavailable` without leaking stored data.
3. Run the focused test and observe the missing exports fail.
4. Wire Admin Firestore ports to the pure handlers. Do not log payloads, Sale
   data, image URLs, or seller-private data.
5. Run:

   ```sh
   npm --prefix functions test -- --run src/index.test.ts src/listingLifecycle.test.ts
   npm --prefix functions run lint
   npm run build:functions
   ```
6. Commit:

   ```sh
   git add functions/src/index.ts functions/src/index.test.ts
   git commit -m "feat: expose trusted listing lifecycle callables"
   ```

## Task 4: Replace browser lifecycle writes with strict callable adapters

**Files:**

- Modify: `src/data/firestore/repositories/saleRepository.ts`
- Modify: `src/data/firestore/repositories/saleRepository.test.ts`
- Modify: `src/data/firestore/repositories/listingRepository.ts`
- Modify: `src/data/firestore/repositories/listingRepository.test.ts`

**Consumes:** Task 1 model and Task 3 callable response contracts.

**Produces:** Strict browser adapters with no direct Sale create or Listing
update/delete operation.

1. Replace repository tests first. Assert exact callable names/payloads and
   strict successful responses. Assert extra/missing fields, invalid timestamps,
   invalid snapshot tuples, invalid availability, and malformed image URL arrays
   reject.
2. Add source-level assertions/mocks that `runTransaction`, `updateDoc`, and
   `deleteDoc` are not imported or invoked by these repositories.
3. Preserve owner-only read query behavior for complete history, including
   suspended users at the Rules layer.
4. Run focused tests and observe failures against direct Firestore writes.
5. Implement callable adapters, version serialization, error propagation, and
   exact response readers. Keep `listSellerSales` as a converter-backed owner
   query.
6. Run:

   ```sh
   npm test -- src/data/firestore/repositories/saleRepository.test.ts src/data/firestore/repositories/listingRepository.test.ts
   ```
7. Commit:

   ```sh
   git add src/data/firestore/repositories/saleRepository.ts src/data/firestore/repositories/saleRepository.test.ts src/data/firestore/repositories/listingRepository.ts src/data/firestore/repositories/listingRepository.test.ts
   git commit -m "refactor: use trusted listing lifecycle callables"
   ```

## Task 5: Make Listing editing inventory-safe

**Files:**

- Modify: `src/features/listings/ListingEditPage.tsx`
- Modify: `src/features/listings/ListingEditPage.test.tsx`
- Modify: `src/features/listings/ListingForm.tsx`
- Modify: `src/features/listings/ListingForm.test.tsx`
- Modify: `src/features/listings/listingDeletion.ts`
- Modify: `src/features/listings/listingDeletion.test.ts`

**Consumes:** Task 4 update/delete adapters.

**Produces:** Editable-field-only form, concurrency handling, ordered deletion
and Storage cleanup semantics.

1. Add failing component/helper tests proving:
   - edit has no remaining-quantity control;
   - sold-out Listing renders a read-only return path, not the form;
   - save sends current `updatedAt` and editable fields only;
   - stale conflict instructs reload and cannot show success;
   - pending save/delete disables duplicate actions;
   - UID/Listing changes invalidate stale promises;
   - deletion calls server first, cleans exactly returned stored image URLs, and
     distinguishes cleanup-only failure.
2. Run focused tests to witness failure.
3. Add an explicit ListingForm capability/variant rather than hiding a generic
   input through CSS. Implement request tokens and pending state.
4. Adopt returned Listing after update. Redirect only after trusted deletion;
   keep a clear cleanup warning if Storage fails.
5. Run focused tests and commit:

   ```sh
   git add src/features/listings/ListingEditPage.tsx src/features/listings/ListingEditPage.test.tsx src/features/listings/ListingForm.tsx src/features/listings/ListingForm.test.tsx src/features/listings/listingDeletion.ts src/features/listings/listingDeletion.test.ts
   git commit -m "fix: protect listing inventory lifecycle"
   ```

## Task 6: Render complete Dashboard sales history

**Files:**

- Modify: `src/features/dashboard/DashboardPage.tsx`
- Modify: `src/features/dashboard/DashboardPage.test.tsx`
- Modify: `src/features/dashboard/dashboardSummary.ts`
- Modify: `src/features/dashboard/dashboardSummary.test.ts`
- Modify: `src/features/listings/ListingPage.tsx`
- Modify: `src/features/listings/ListingPage.test.tsx`
- Modify: `src/styles.css`

**Consumes:** Tasks 1 and 4 history values and record-sale response.

**Produces:** Full history UI and sold-out read-only surfaces.

1. Add failing tests for newest-first deterministic rows, Taiwan date/time,
   snapshot and recognized-legacy metadata, quantities, both unit prices, line
   totals, Listing links, totals, and honest unavailable metadata.
2. Cover empty/loading/error, active seller, suspended read-only seller, and
   stale UID/reload results.
3. Assert Sale submission is pending-safe, adopts/refreshes after callable
   success, and retains input/actionable error on failure.
4. Assert sold-out Dashboard/detail remains visible but has no edit, sale,
   contact reveal, or delete entry point.
5. Run focused tests and observe missing history rows/controls fail.
6. Implement semantic table/list markup responsive at narrow widths, with
   `aria-live` status and token-based focus styles. Do not show seller contact in
   history.
7. Run:

   ```sh
   npm test -- src/features/dashboard/DashboardPage.test.tsx src/features/dashboard/dashboardSummary.test.ts src/features/dashboard/salesHistory.test.ts src/features/listings/ListingPage.test.tsx
   ```
8. Commit:

   ```sh
   git add src/features/dashboard/DashboardPage.tsx src/features/dashboard/DashboardPage.test.tsx src/features/dashboard/dashboardSummary.ts src/features/dashboard/dashboardSummary.test.ts src/features/listings/ListingPage.tsx src/features/listings/ListingPage.test.tsx src/styles.css
   git commit -m "feat: show complete seller sales history"
   ```

## Task 7: Enforce lifecycle boundaries in Firestore Rules

**Files:**

- Modify: `firestore.rules`
- Modify: `src/rules/firebaseRules.test.ts`

**Consumes:** Callable-only mutation architecture.

**Produces:** Direct-browser bypass denial and strict Listing creation.

1. Add failing Emulator tests proving active owners cannot directly create a
   Sale or update/delete an existing Listing. Include an otherwise perfectly
   shaped atomic browser transaction to prove it is still denied.
2. Prove strict create accepts the canonical current Listing and rejects unknown
   keys, transferred seller, non-equal initial quantities, derived/sold-out
   status, invalid metadata tuple, invalid price/fees/images, and malformed
   timestamps.
3. Prove guests read only active Listings while owners (including suspended)
   read their own sold-out Listings and Sales.
4. Run `npm run test:rules` and observe old owner writes unexpectedly pass.
5. Tighten Rules with small validation helpers and deny existing Listing/Sale
   mutations. Preserve all unrelated Batch 3/4 rules.
6. Rerun Rules plus focused creation repository tests.
7. Commit:

   ```sh
   git add firestore.rules src/rules/firebaseRules.test.ts
   git commit -m "security: enforce trusted listing lifecycle"
   ```

## Task 8: Add a dry-run legacy Sale snapshot audit/backfill

**Files:**

- Create: `scripts/migrate-sale-snapshots.mjs`
- Create: `scripts/migrate-sale-snapshots.test.mjs`
- Modify: `package.json`
- Modify: `scripts/package-contract.test.mjs`

**Consumes:** Task 1 persisted current/legacy contracts.

**Produces:** Safe production-readiness tool, not an executed migration.

1. Add failing pure planning tests for normalized, resolvable legacy,
   missing-Listing, ambiguous, malformed, and snapshot-conflict cases.
2. Add CLI safety tests: dry-run default; apply requires explicit project,
   non-existing backup and `--apply`; production-looking project without the
   full gate aborts; no delete; <=400 writes/readbacks per batch; verify before
   success; backup supports Admin Timestamp values.
3. Add package-contract failure for the missing script.
4. Implement dependency-injected planning/I/O and deterministic JSON reporting.
   Never fetch Card effect text or images. Backfill only from canonical Listing
   snapshots; do not guess from visible IDs.
5. Run focused then full script tests.
6. Do **not** run `--apply` or point the tool at production.
7. Commit:

   ```sh
   git add scripts/migrate-sale-snapshots.mjs scripts/migrate-sale-snapshots.test.mjs package.json scripts/package-contract.test.mjs
   git commit -m "feat: audit legacy sale snapshots safely"
   ```

## Task 9: Prove the complete lifecycle in Chromium E2E

**Files:**

- Modify: `e2e/sales-authorization.spec.ts`
- Modify: `e2e/listing-lifecycle.spec.ts`
- Modify: `e2e/mvp-journey.spec.ts`
- Modify if required: `e2e/support/emulator-state.ts`
- Modify if required: `e2e/support/emulator-state.spec.ts`

**Consumes:** Tasks 3–7.

**Produces:** Browser + Auth/Firestore/Storage/Functions Emulator evidence.

1. Update/add tests before application fixes are considered complete:
   - direct owner REST/SDK Sale create and Listing update/delete are denied;
   - callable records partial then final Sales atomically;
   - two sale attempts cannot oversell;
   - non-owner and suspended attempts change nothing;
   - reload shows every history field in deterministic order and exact totals;
   - sold-out Listing stays in seller Dashboard/direct route and is absent from
     public Marketplace;
   - sold-out/history-bearing deletion is unavailable/rejected;
   - unsold deletion succeeds and cleans emulator Storage;
   - edit cannot modify quantity and stale edit does not overwrite a Sale.
2. Run focused Chromium files through `firebase emulators:exec`; observe at least
   one intended failure against the previous interaction contract.
3. Make only E2E support/selector corrections required by the approved behavior.
4. Rerun focused files to green; leave the full  suite for Task 11.
5. Commit:

   ```sh
   git add e2e/sales-authorization.spec.ts e2e/listing-lifecycle.spec.ts e2e/mvp-journey.spec.ts e2e/support/emulator-state.ts e2e/support/emulator-state.spec.ts
   git commit -m "test: verify trusted sales history end to end"
   ```


## Task 10: Document migration and release operations

**Files:**

- Modify: `docs/firebase-setup.md`
- Modify: `docs/milestones.md`
- Modify: `functions/src/index.test.ts`
- Modify: `scripts/package-contract.test.mjs`


1. Add failing documentation-contract assertions for callable names, exact
   dry-run/apply commands, backup and no-authorization language, lifecycle
   release order, legacy handling, and non-invasive verification.
2. Document exact commands:

   ```sh
   npm run migrate:sale-snapshots -- --project conantcgmarket
   npm run migrate:sale-snapshots -- --project conantcgmarket --backup ./backups/sale-snapshots-YYYYMMDD.json --apply
   ```
3. State clearly that approval of designs/code does not authorize `--apply`,
   deployment, production writes, real Sale creation, or deletion.
4. Document Functions → separately approved audit/backfill → Rules → frontend,
   rollback/monitoring, and local Emulator verification.
5. Update milestone status to repository-ready, not production-live.
6. Run focused documentation/package contracts and commit:

   ```sh
   git add docs/firebase-setup.md docs/milestones.md functions/src/index.test.ts scripts/package-contract.test.mjs
   git commit -m "docs: add trusted lifecycle rollout runbook"
   ```

## Task 11: Verify Batch 5 end to end

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
3. Scan lifecycle references:

   ```sh
   rg -n "runTransaction|updateDoc|deleteDoc|recordListingSale|updateSellerListing|deleteUnsoldListing|remainingQuantity|sales" src functions/src firestore.rules scripts e2e
   ```

4. Confirm no browser repository can create/update/delete Sales or mutate/delete
   an existing Listing; creation remains the only permitted Listing browser write.
5. Map every spec acceptance criterion to a focused/unit/Rules/E2E result. If
   evidence is missing, add a failing regression test and repeat RED → GREEN.
6. Record totals, warnings, commits, and explicitly state that no production
   migration/deployment/mutation occurred before starting Batch 6.
