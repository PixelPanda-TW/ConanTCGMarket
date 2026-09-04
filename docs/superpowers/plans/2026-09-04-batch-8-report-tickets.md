# Batch 8 Report Tickets Implementation Plan

> Execute every task in order. Witness RED before production changes, make the
> smallest GREEN change, rerun the focused tests, and commit each task. Use only
> fixed demo Emulators for browser/Rules integration. Do not deploy, submit a
> production report, upload production evidence, send email, or mutate
> production data.

**Goal:** Let an active Google user submit a bounded, evidence-backed report
about another seller's active Listing into a private moderation queue.

**Architecture:** Two callable Functions own draft creation and finalization.
The browser may write up to three image objects only beneath the authenticated
reporter's unexpired draft path; it never reads moderation data directly.
Finalization verifies real object metadata and stores an immutable safe Listing
snapshot. A bounded scheduled cleanup removes expired drafts only.

**Spec:** `docs/superpowers/specs/2026-09-04-batch-8-report-tickets-design.md`

## Task 1: Model the report contract in both runtimes

**Files:**

- Create: `src/domain/models/moderationReport.ts`
- Modify: `src/domain/models/index.ts`
- Modify: `src/domain/models/domainModels.test.ts`
- Create: `functions/src/reportTickets.ts`
- Create: `functions/src/reportTickets.test.ts`

1. Add failing tests for the five exact categories, trimmed 1–100-character
   descriptions, UUID request IDs, exact safe Listing snapshots, zero-to-three
   evidence paths/metadata, exact draft/submitted shapes, timestamps, and
   rejection of contact/email/extra fields.
2. Implement strict frontend validators and server parsers/constants. Keep
   server Timestamp types out of the frontend model.
3. Run the two focused suites and commit `feat: model moderation reports`.

## Task 2: Implement idempotent draft creation

**Files:**

- Modify: `functions/src/reportTickets.ts`
- Modify: `functions/src/reportTickets.test.ts`

1. Add failing dependency-injected tests for active account, active Listing,
   non-owner, immutable snapshot projection, 24-hour expiry, SHA-256
   UID/request-ID key, same-request retry, conflict rejection, exact 10-per-UTC-
   day counter, and sanitized errors.
2. Implement `createReportDraft` as one transaction-shaped domain operation.
   A retry returns the same compatible draft and does not consume another limit.
3. Run GREEN and commit `feat: create moderation report drafts`.

## Task 3: Implement evidence-verified finalization

**Files:**

- Modify: `functions/src/reportTickets.ts`
- Modify: `functions/src/reportTickets.test.ts`

1. Add failing tests for owner/active/unexpired checks, canonical unique slot
   paths, actual metadata reads, type/size validation, no-evidence submission,
   immutable submitted data, identical retry, conflicting retry, and no
   description/evidence leakage in errors.
2. Implement `submitReport` with metadata verification before the final atomic
   state transition. Store path, type, size, generation, and MD5 when present.
3. Run GREEN and commit `feat: submit verified moderation reports`.

## Task 4: Implement bounded expired-draft cleanup

**Files:**

- Create: `functions/src/reportCleanup.ts`
- Create: `functions/src/reportCleanup.test.ts`
- Modify: `functions/src/reportTickets.ts`

1. Add failing tests for bounded pages, only expired drafts, three canonical
   slots, object-not-found idempotency, submitted-report preservation, pointer
   cleanup, partial failure behavior, and payload-free logging inputs.
2. Implement cleanup as a dependency-injected operation that deletes evidence
   before atomically deleting the still-expired draft and its request pointer.
3. Run GREEN and commit `feat: clean expired report drafts`.

## Task 5: Expose trusted Functions adapters

**Files:**

- Modify: `functions/src/index.ts`
- Modify: `functions/src/index.test.ts`
- Modify: `functions/src/config.test.ts`
- Modify: `firestore.indexes.json`

1. Add failing deployment/adapter tests for callable-only
   `createModerationReportDraft` and `submitModerationReport`, scheduled-only
   `cleanupExpiredReportDrafts`, exact Auth/account checks, bounded Admin
   reads/transactions, Storage metadata/deletes, sanitized logging, runtime,
   schedule, and the cleanup composite index.
2. Wire Admin Firestore/Storage dependencies. Convert callable input/output at
   the boundary and do not export test fakes or public HTTP handlers.
3. Run Functions tests/lint/build and commit `feat: expose report ticket functions`.

## Task 6: Add the frontend callable repository

**Files:**

- Create: `src/data/firestore/repositories/moderationReportRepository.ts`
- Create: `src/data/firestore/repositories/moderationReportRepository.test.ts`
- Modify: `src/data/firestore/repositories/index.ts`

1. Add failing tests for current-user ownership, exact callable names/payloads,
   strict response parsing, ISO date conversion, stable request retry, generic
   service errors, and no Firestore client mutation.
2. Implement typed `createModerationReportDraft` and
   `submitModerationReport` repository functions.
3. Run GREEN and commit `feat: call report ticket functions`.

## Task 7: Add report evidence Storage operations

**Files:**

- Modify: `src/data/storage/storageService.ts`
- Create: `src/data/storage/storageService.test.ts`

1. Add failing tests for exact UID/report/slot paths, 0–2 slots, accepted MIME
   types, 5 MiB bound, upload progress/failure, replacement/delete, and refusal
   before any SDK call for malformed input.
2. Implement upload/delete helpers without download URLs. Return only canonical
   object paths needed by finalization.
3. Run GREEN and commit `feat: manage report evidence uploads`.

## Task 8: Build the report page

**Files:**

- Create: `src/features/reports/reportForm.ts`
- Create: `src/features/reports/reportForm.test.ts`
- Create: `src/features/reports/ReportListingPage.tsx`
- Create: `src/features/reports/ReportListingPage.test.tsx`
- Modify: `src/styles.css`

1. Add failing tests for signed-out guidance, active-account gate, missing/
   sold-out/owned Listing denial, category/description/evidence validation,
   zero/three image success, pending single-flight, staged retry/cleanup,
   identity/route stale-result guards, accessible errors/focus, and opaque
   success reference.
2. Implement the dedicated report form using existing page/form tokens and
   repository/storage helpers. Never render internal moderation state or contact.
3. Run component tests and commit `feat: add listing report form`.

## Task 9: Connect route and Listing entry point

**Files:**

- Modify: `src/route.ts`
- Modify: `src/route.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/features/listings/ListingPage.tsx`
- Modify: `src/features/listings/ListingPage.test.tsx`

1. Add failing tests for `#/listing/:id/report`, active non-owner visibility,
   guest sign-in continuity, and absence for owner/sold/suspended/unavailable.
2. Route before the generic Listing matcher and pass canonical listing ID only.
   Add the entry point without changing contact/follow/edit behavior.
3. Run GREEN and commit `feat: connect listing report entry point`.

## Task 10: Lock Firestore and Storage boundaries

**Files:**

- Modify: `firestore.rules`
- Modify: `storage.rules`
- Modify: `src/rules/firebaseRules.test.ts`

1. Add failing Emulator tests proving all report Firestore collections are
   browser-inaccessible; evidence reads always fail; only active draft owners
   may create/update/delete slots 0–2 with approved type/size; owner mismatch,
   expired/submitted draft, suspension, malformed access, path/type/size/count,
   and post-submit writes fail.
2. Add minimal report-evidence Rules. Keep Listing image behavior unchanged.
3. Run  Rules GREEN and commit `security: isolate moderation report evidence`.

## Task 11: Verify report tickets end to end

**Files:**

- Modify: `e2e/support/emulator-state.ts`
- Modify: `e2e/support/emulator-state.spec.ts`
- Create: `e2e/report-tickets.spec.ts`
- Modify: `e2e/mobile-forms.spec.ts`

1. Extend exact Admin seeds/reads for report documents, counters, and private
   evidence while preserving the fixed demo-project guard.
2. Cover guest sign-in → report page, active buyer with no Seller Profile,
   optional and three-image submissions, exact private document/object shape,
   reload success, and immutable evidence.
3. Cover owner/sold/suspended/other-user denial, invalid fields/files, retry
   idempotency, daily limit, and absence of contact/email fields.
4. Run focused Chromium and WebKit files to GREEN; commit
   `test: verify report tickets end to end`.

## Task 12: Document operations and verify Batch 8

**Files:**

- Modify: `docs/firebase-setup.md`
- Modify: `docs/integration-testing.md`
- Modify: `docs/milestones.md`
- Modify: `functions/src/index.test.ts`
- Modify: `scripts/package-contract.test.mjs`

1. Add failing documentation contracts for report/evidence limits, privacy,
   idempotency, cleanup, no email, no migration, Functions → Rules → frontend,
   non-invasive verification, monitoring, rollback, and repository-ready/not-
   production-live status.
2. Run all frontend, script, Functions, lint/build, Rules, E2E Chromium/WebKit,
   production build, diff, and status gates under Node 22. Never source a
   production credential environment for Emulator tests.
3. Audit all report entry points, callable adapters, Firestore/Storage paths,
   logs, and fields. Map all ten acceptance criteria to test evidence.
4. Commit `docs: add report ticket runbook` and record that no production report,
   evidence, email, deploy, cleanup, or data mutation occurred before Batch 9.
