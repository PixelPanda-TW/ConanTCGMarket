# Batch 10 Account Suspension and Restoration Implementation Plan

> Execute every task in order. Witness RED before production changes, make the
> smallest GREEN change, rerun focused tests, and commit each task. Use only the
> fixed demo Emulators for integration. Do not deploy, inspect real moderation
> data, suspend/restore a production account, hide/republish a production
> Listing, send email, or mutate production data.

**Goal:** Let an active exact-claim admin manually suspend an eligible account,
reliably hide all of its active Listings, restore the account without erasing
history, and let the restored owner selectively republish held Listings.

**Architecture:** A strict callable opens one idempotent server-only suspension
operation and immediately writes suspended account access. Bounded reconciliation
holds active Listings under that action and a scheduled retry finishes interrupted
work. Restoration reactivates only the account. A separate owner callable
republishes one held Listing. Create-only private audit events and strict DTOs
make every state transition inspectable without direct browser data access.

**Spec:** `docs/superpowers/specs/2026-09-05-batch-10-account-suspension-restoration-design.md`

## Task 1: Model account suspension operation and audit contracts

**Files:**

- Create: `functions/src/accountModeration.ts`
- Create: `functions/src/accountModeration.test.ts`
- Create: `src/domain/models/accountModeration.ts`
- Modify: `src/domain/models/accountAccess.ts`
- Modify: `src/domain/models/index.ts`
- Modify: `src/domain/models/domainModels.test.ts`

1. Add failing server/frontend tests for exact operation states (`hiding`,
   `suspended`, `restored`), four audit variants, UUID request IDs, identifiers,
   reasons, counts, strict timestamps, current-operation/admin DTOs, and rejection
   of contact/email/report/evidence/extra fields.
2. Require `suspensionActionId` on suspended account records while preserving the
   existing exact active shape and missing-document compatibility.
3. Implement strict parsers, wire-date converters, status constants, and DTO
   validators. Keep Admin Timestamp types out of the frontend.
4. Run focused frontend and Functions tests to GREEN.
5. Commit `feat: model account moderation operations`.

## Task 2: Model held Listings across browser and trusted lifecycle code

**Files:**

- Modify: `src/domain/models/listing.ts`
- Modify: `src/domain/models/domainModels.test.ts`
- Modify: `src/data/firestore/converters.ts`
- Modify: `src/data/firestore/converters.test.ts`
- Modify: `functions/src/listingLifecycle.ts`
- Modify: `functions/src/listingLifecycle.test.ts`
- Modify: `functions/src/listingEvents.test.ts`

1. Add failing tests for exact `suspended` Listing shape, required action/time
   hold fields, forbidden hold fields on active/sold-out records, legacy metadata
   compatibility, and fail-closed malformed combinations.
2. Extend browser and server Listing parsing. Existing edit may preserve a hold;
   Sale always rejects it; unsold delete may accept it only for an active owner;
   create remains active-only. Re-prove that updates never emit create events.
3. Run focused model/converter/lifecycle/event tests to GREEN.
4. Commit `feat: model suspension-held listings`.

## Task 3: Open an idempotent suspension operation

**Files:**

- Modify: `functions/src/accountModeration.ts`
- Modify: `functions/src/accountModeration.test.ts`

1. Add failing dependency-injected transaction tests for exact
   `{ reportId, requestId, reason }`; signed-out/non-admin/suspended/malformed
   admin denial; self-target denial; confirmed case/target/count requirements;
   admin-bound request-key derivation; canonical suspended account write;
   one `hiding` operation; one create-only request audit; and no Listing/Auth/email
   mutation inside the opening transaction.
2. Add retry/concurrency tests: exact retry returns/resumes the same action;
   different payload/admin, pre-existing incompatible key, already-suspended
   target, stale case pair, malformed access, or count below two makes no write.
3. Implement `suspendModerationTarget` opening logic with strict exact parsing,
   safe timestamps, and sanitized errors.
4. Run focused Functions tests to GREEN.
5. Commit `feat: open account suspension operations`.

## Task 4: Reconcile active Listings into holds

**Files:**

- Modify: `functions/src/accountModeration.ts`
- Modify: `functions/src/accountModeration.test.ts`

1. Add failing tests for deterministic bounded active-Listing pages; target and
   action verification; exact Listing parsing; status/action/time patches;
   hidden-count accumulation; repeated pages; completion only after an empty
   page; deterministic create-only completion audit; and sold-out/already-held/
   other-seller preservation.
2. Add failure/retry tests for partial progress, duplicate invocation,
   conflicting operation/account state, malformed Listing, unsafe count,
   transaction conflict, and a per-invocation work bound.
3. Implement one-page reconciliation plus a bounded drain helper. Never read
   image bytes, write Sales, delete images, or generate Listing events.
4. Run focused Functions tests to GREEN.
5. Commit `feat: reconcile suspended seller listings`.

## Task 5: Restore only a completed suspension

**Files:**

- Modify: `functions/src/accountModeration.ts`
- Modify: `functions/src/accountModeration.test.ts`

1. Add failing tests for exact
   `{ reportId, suspensionActionId, requestId, reason }`, active-admin/non-self
   gate, confirmed case target, completed action requirement, canonical active
   account result with preserved count, restored operation, and create-only audit.
2. Prove no Listing, case, violation count, Auth identity, or email changes.
   Exact retry is idempotent; hiding/stale/mismatched/malformed/conflicting
   restoration causes no write.
3. Implement restoration in one Firestore transaction.
4. Run focused Functions tests to GREEN.
5. Commit `feat: restore moderated accounts`.

## Task 6: Republish one restored owner's held Listing

**Files:**

- Modify: `functions/src/accountModeration.ts`
- Modify: `functions/src/accountModeration.test.ts`

1. Add failing transactional tests for exact `{ listingId, suspensionActionId }`,
   active authenticated owner, exact held Listing, completed/restored operation,
   positive remaining quantity, active-shape patch removing hold fields, and one
   deterministic create-only republish audit.
2. Prove exact retry idempotency and denial for signed-out/suspended/other owner,
   stale action, hiding action, active/sold-out/malformed Listing, and concurrent
   later suspension. Assert no Listing event, Sale, image, or email write.
3. Implement `republishSuspendedListing` with one transaction and generic errors.
4. Run focused Functions tests to GREEN.
5. Commit `feat: selectively republish held listings`.

## Task 7: Expose bounded history through moderation detail

**Files:**

- Modify: `functions/src/moderationReview.ts`
- Modify: `functions/src/moderationReview.test.ts`
- Modify: `src/domain/models/moderationCase.ts`
- Modify: `src/domain/models/domainModels.test.ts`

1. Add failing tests extending case detail with the current suspension operation
   and at most 20 newest-first target audit events. Cover active/suspended,
   hiding/completed/restored, missing history, ordering, pair mismatches, and
   strict privacy allowlists.
2. Extend the detail dependency and DTO parser. Do not expose operation request
   keys, contact, email, report evidence/body beyond existing detail, or raw
   Firestore data.
3. Run focused frontend and Functions tests to GREEN.
4. Commit `feat: expose account moderation history`.

## Task 8: Wire Functions, schedule, Firestore queries, and indexes

**Files:**

- Modify: `functions/src/index.ts`
- Modify: `functions/src/index.test.ts`
- Modify: `functions/src/config.test.ts`
- Modify: `firestore.indexes.json`

1. Add failing adapter/manifest tests for callable-only
   `suspendModerationTarget`, `restoreModerationTarget`, and
   `republishSuspendedListing`; scheduled
   `reconcileAccountModerationOperations`; exact boolean claim forwarding;
   Admin transaction/create/update ports; deterministic bounded queries; and
   content-free logs.
2. Add composite indexes for seller/status Listing draining, pending operation
   reconciliation, and target/time audit history. Assert exact order/direction.
3. Wire bounded runtime options and a scheduled retry that processes a fixed
   number of oldest hiding operations. Export no unauthenticated HTTP or test
   handler.
4. Run Functions tests, lint, build, and config/index contracts to GREEN.
5. Commit `feat: expose account moderation functions`.

## Task 9: Add strict frontend callable repositories

**Files:**

- Create: `src/data/firestore/repositories/accountModerationRepository.ts`
- Create: `src/data/firestore/repositories/accountModerationRepository.test.ts`
- Modify: `src/data/firestore/repositories/index.ts`

1. Add failing tests for exact callable names/payloads, UUID request creation,
   strict suspend/restore/republish response parsing, generic error preservation,
   retry input stability, and rejection of extra/private fields.
2. Implement typed callable-only adapters. Do not import direct moderation
   Firestore or Storage APIs.
3. Run focused repository tests to GREEN.
4. Commit `feat: consume account moderation functions`.

## Task 10: Add suspension and restoration controls to admin detail

**Files:**

- Create: `src/features/admin/accountModerationForm.ts`
- Create: `src/features/admin/accountModerationForm.test.ts`
- Modify: `src/features/admin/ModerationCasePage.tsx`
- Modify: `src/features/admin/ModerationCasePage.test.tsx`
- Modify: `src/styles.css`

1. Add failing tests for eligibility/confirmed/non-self visibility; all auth and
   account gates; reason validation; accessible dialogs; request ID stability;
   single-flight calls; no optimistic state; exact refresh; hiding progress;
   completed suspension; restoration; audit history; stale route/identity
   invalidation; error retry; focus loop/Escape/restoration; and mobile layout.
2. Implement deliberate `停權帳號` and `恢復帳號` workflows using the existing
   detail route and design tokens. Never expose a self-action, automatic action,
   raw operation document, or production-only control.
3. Run focused component/style tests to GREEN.
4. Commit `feat: manage account access from moderation review`.

## Task 11: Present held Listings and selective republish in Dashboard

**Files:**

- Modify: `src/features/dashboard/dashboardSummary.ts`
- Modify: `src/features/dashboard/dashboardSummary.test.ts`
- Modify: `src/features/dashboard/DashboardPage.tsx`
- Modify: `src/features/dashboard/DashboardPage.test.tsx`
- Modify: `src/features/listings/ListingPage.tsx`
- Modify: `src/features/listings/ListingPage.test.tsx`
- Modify: `src/features/listings/ListingEditPage.tsx`
- Modify: `src/features/listings/ListingEditPage.test.tsx`
- Modify: `src/styles.css`

1. Add failing tests showing held Listings in a separate section, excluded from
   active counts, retained for suspended read-only sellers, owner-only direct
   detail, and no edit/delete/republish while account access is suspended.
2. Add restored-owner tests for edit, eligible delete, confirm/retry republish,
   exact action ID, single flight, trusted reload, success/error states, and no
   fake event/UI optimism. Re-prove sold-out history and totals.
3. Implement the held Listing presentation and individual controls. Keep images,
   identity, quantity, and Sale history unchanged.
4. Run focused dashboard/listing tests to GREEN.
5. Commit `feat: manage suspension-held listings`.

## Task 12: Lock operation, audit, and held-Listing boundaries in Rules

**Files:**

- Modify: `firestore.rules`
- Modify: `src/rules/firebaseRules.test.ts`

1. Add failing Emulator tests proving anonymous, ordinary, suspended, malformed,
   and admin-claim browsers cannot read/list/write operation or audit documents.
2. Prove public/other users cannot read held Listings; owners can read them;
   browser updates/deletes remain denied; suspended users cannot create Listings
   or mutate any privileged collection/Storage path; active behavior remains.
3. Add only explicit server-only collection matches and required exact suspended
   account/Listing compatibility. Do not add an admin browser bypass.
4. Run Rules Emulator tests to GREEN.
5. Commit `security: isolate account moderation state`.

## Task 13: Verify the complete lifecycle in browser Emulators

**Files:**

- Modify: `e2e/support/emulator-state.ts`
- Modify: `e2e/support/emulator-state.spec.ts`
- Create: `e2e/account-moderation.spec.ts`
- Modify: `e2e/account-access.spec.ts`
- Modify: `e2e/public-marketplace.spec.ts`
- Modify: `e2e/mobile-forms.spec.ts`

1. Add guarded exact seeds/reads for operations, audit events, suspended Listings,
   and reconciliation invocation. Reject non-demo projects, remote hosts, extra
   fields, and unbounded reads.
2. Add Chromium coverage for admin eligibility → suspension request → partial/
   completed hide → Marketplace removal → seller read-only Dashboard → restore →
   edit/selective republish → Marketplace return. Assert sold-out and Sale
   preservation, no Listing event, immutable history, and reload behavior.
3. Cover exact retries, conflicting/concurrent suspend/restore/republish,
   self-action, malformed state, stale action, reconciler recovery, direct Rules
   denial, ordinary/suspended admin denial, and generic UI errors.
4. Add iPhone WebKit coverage for both admin dialogs, progress/history, held
   Listing section, and republish confirmation without overflow.
5. Run focused Chromium/WebKit specs to GREEN.
6. Commit `test: verify account moderation end to end`.

## Task 14: Add operations runbook and run every release gate

**Files:**

- Modify: `docs/firebase-setup.md`
- Modify: `docs/integration-testing.md`
- Modify: `docs/milestones.md`
- Modify: `functions/src/index.test.ts`
- Modify: `scripts/package-contract.test.mjs`

1. Add failing documentation contracts for manual threshold policy,
   authenticated read-only suspension, resumable hiding, selective republish,
   private immutable audit, no Auth disable/email/migration, exact release order,
   non-invasive verification, monitor/rollback, and repository-ready/not-live
   status.
2. Document the ten acceptance criteria, fixed
   **Functions → indexes → Rules → frontend** order, reconciler monitoring,
   fail-closed repair, and rollback that never deletes audit/decrements counts/
   bulk republishes.
3. Run from Node.js 22:
   - full frontend Vitest;
   - full scripts contracts;
   - full Functions Vitest, lint, and build;
   - production and E2E frontend builds with local web config;
   - full Firestore/Storage Rules Emulator suite;
   - full Chromium E2E;
   - full iPhone WebKit E2E.
4. Audit routes, callable/schedule manifests, indexes, Rules, Listing field
   variants, operation/audit allowlists, reconciliation bounds, log payloads,
   and all ten acceptance criteria.
5. Commit `docs: add account moderation runbook`. Record explicitly that no
   production moderation read, suspension/restoration, Listing hide/republish,
   email, deployment, or data mutation occurred.
