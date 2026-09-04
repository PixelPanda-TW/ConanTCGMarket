# Batch 9 Admin Moderation Review Implementation Plan

> Execute every task in order. Witness RED before production changes, make the
> smallest GREEN change, rerun the focused tests, and commit each task. Use only
> fixed demo Emulators for Rules/browser integration. Do not deploy, inspect real
> reports/evidence, decide a production case, change a production violation
> count, send email, or mutate production data.

**Goal:** Give an active exact-claim admin a private queue to inspect submitted
reports and evidence, dismiss a case, or atomically confirm one violation.

**Architecture:** Report submission atomically creates one open
`moderationCases/{reportId}` document. Four strict callable Functions list
summaries, load one detail, return one verified evidence object, and make one
terminal idempotent decision. Confirmation updates the case and target
`accountAccess` in one transaction. The browser consumes DTOs only and has no
direct moderation Firestore or Storage access.

**Spec:** `docs/superpowers/specs/2026-09-04-batch-9-admin-moderation-review-design.md`

## Task 1: Model moderation cases in both runtimes

**Files:**

- Create: `src/domain/models/moderationCase.ts`
- Modify: `src/domain/models/index.ts`
- Modify: `src/domain/models/domainModels.test.ts`
- Create: `functions/src/moderationReview.ts`
- Create: `functions/src/moderationReview.test.ts`

1. Add failing frontend/server tests for exact open, dismissed, and confirmed
   case shapes; strict report/category/listing snapshots; rationale trimmed to
   1–1,000 characters; evidence summaries; account summaries; status filters;
   deterministic cursors; exact requests/responses; timestamps; and rejection
   of contact/email/path/hash/extra fields.
2. Implement constants, types, exact parsers, DTO validators, and wire-date
   conversion helpers. Keep Firebase Admin types server-only and require
   canonical sorted evidence slots 0–2.
3. Run focused frontend and Functions suites to GREEN.
4. Commit `feat: model moderation cases`.

## Task 2: Create an open case atomically with report submission

**Files:**

- Modify: `functions/src/reportTickets.ts`
- Modify: `functions/src/reportTickets.test.ts`
- Modify: `functions/src/index.ts`
- Modify: `functions/src/index.test.ts`

1. Add failing tests proving successful finalization creates exactly
   `moderationCases/{reportId}` with `openedAt === submittedAt`; report and case
   are one transaction; identical report retries require the compatible open or
   terminal case and create nothing; a missing/conflicting case aborts; metadata
   failure creates neither report transition nor case.
2. Extend the submission transaction interface and Admin adapter with strict
   get/create case operations. Preserve immutable report data and Batch 8
   evidence verification.
3. Run focused report and index suites, lint, and Functions build to GREEN.
4. Commit `feat: open moderation cases on report submission`.

## Task 3: Implement bounded admin case listing

**Files:**

- Modify: `functions/src/moderationReview.ts`
- Modify: `functions/src/moderationReview.test.ts`

1. Add failing dependency-injected tests for unauthenticated, non-admin,
   suspended/malformed admin access, all four status filters, default/max limits,
   descending `(openedAt, documentId)` cursor semantics, at-most-50 report
   lookups, safe summary projection, next cursor, empty pages, and missing/
   malformed/mismatched pair failure.
2. Implement `listModerationCases` as a strict handler over a bounded list
   dependency. Return no reporter, description, rationale, evidence, contact,
   email, or Google presentation fields.
3. Run focused Functions tests to GREEN.
4. Commit `feat: list private moderation cases`.

## Task 4: Implement exact admin case detail

**Files:**

- Modify: `functions/src/moderationReview.ts`
- Modify: `functions/src/moderationReview.test.ts`

1. Add failing tests for active exact-claim admin access, exact report/case pair,
   draft/missing/malformed/target-mismatch rejection, safe evidence slot
   projection, missing/active/suspended target summaries, suspension eligibility,
   terminal rationale/count projection, and privacy field allowlists.
2. Implement `getModerationCase` with bounded reads and strict fail-closed
   parsing. Missing target access maps only to active/count-zero presentation;
   malformed target access fails.
3. Run focused Functions tests to GREEN.
4. Commit `feat: inspect moderation case details`.

## Task 5: Implement authenticated evidence retrieval

**Files:**

- Modify: `functions/src/moderationReview.ts`
- Modify: `functions/src/moderationReview.test.ts`

1. Add failing tests for exact `{ reportId, slot }`, active-admin gate, recorded
   slot requirement, canonical path reconstruction, MIME/size/generation
   equality, generation-pinned download, 5 MiB cap, base64 response, one-object
   bound, missing/changed object, and sanitized errors/log inputs.
2. Implement `getModerationEvidence` through metadata and generation-pinned
   download dependencies. Never return path, generation, hash, token, or URL.
3. Run focused Functions tests to GREEN.
4. Commit `feat: retrieve private moderation evidence`.

## Task 6: Implement terminal idempotent decisions

**Files:**

- Modify: `functions/src/moderationReview.ts`
- Modify: `functions/src/moderationReview.test.ts`

1. Add failing transactional tests for dismissal without account write;
   confirmation from missing/active/suspended access; exact count increment;
   status-field preservation; two-count eligibility without suspension; malformed
   access; report/case mismatch; identical retry; different admin/decision/
   rationale retry; and simultaneous conflicting decisions.
2. Implement `decideModerationCase`. Read case, report, and target access in one
   transaction. Write one terminal case and, only for a new confirmation, one
   canonical account-access value. Never write Auth, Listing, evidence, or email.
3. Run focused Functions tests to GREEN.
4. Commit `feat: decide moderation cases atomically`.

## Task 7: Expose trusted moderation Function adapters

**Files:**

- Modify: `functions/src/index.ts`
- Modify: `functions/src/index.test.ts`
- Modify: `functions/src/config.test.ts`
- Modify: `firestore.indexes.json`

1. Add failing deployment/adapter tests for callable-only
   `listModerationCases`, `getModerationCase`, `getModerationEvidence`, and
   `decideModerationCase`; exact claim/account checks; bounded Admin queries and
   `getAll`; transactional case/count writes; generation-pinned Storage download;
   status/all indexes; runtime limits; and content-free logging.
2. Wire Firestore and Storage Admin dependencies, strict boundary conversion,
   sanitized `HttpsError` mapping, and a sufficient bounded memory/response
   configuration for one maximum evidence object. Export no public HTTP or test
   handler.
3. Run Functions tests, lint, build, and index contract tests to GREEN.
4. Commit `feat: expose moderation review functions`.

## Task 8: Add the frontend moderation repository and evidence lifecycle

**Files:**

- Create: `src/data/firestore/repositories/moderationReviewRepository.ts`
- Create: `src/data/firestore/repositories/moderationReviewRepository.test.ts`
- Modify: `src/data/firestore/repositories/index.ts`
- Create: `src/features/admin/moderationEvidence.ts`
- Create: `src/features/admin/moderationEvidence.test.ts`

1. Add failing tests for exact callable names/payloads, status/cursor bounds,
   strict summary/detail/decision/evidence response parsing, millisecond-to-Date
   conversion, generic service errors, MIME/base64 validation, Blob creation,
   URL revocation, and refusal of path/hash/contact/email/extra fields.
2. Implement typed repository calls and a small evidence controller that creates
   only local Blob URLs and always revokes them. Do not import Firestore or
   Storage data APIs into this repository.
3. Run focused frontend tests to GREEN.
4. Commit `feat: consume moderation review functions`.

## Task 9: Build the protected moderation queue

**Files:**

- Create: `src/features/admin/ModerationQueuePage.tsx`
- Create: `src/features/admin/ModerationQueuePage.test.tsx`
- Modify: `src/styles.css`

1. Add failing tests for signed-out/loading/non-admin/unavailable/suspended/
   active-admin states; zero calls outside active-admin; all four filters;
   loading/empty/error/retry; deterministic append pagination; duplicate
   protection; UID/route stale-result isolation; approved summary fields; and
   keyboard/mobile accessibility.
2. Implement the queue using existing admin/page tokens, status tabs, summary
   cards/table as appropriate, and `載入更多`. Never render reporter identity,
   description, rationale, or evidence on the queue.
3. Run focused component tests to GREEN.
4. Commit `feat: add moderation review queue`.

## Task 10: Build detail, evidence, and decision UI

**Files:**

- Create: `src/features/admin/moderationDecisionForm.ts`
- Create: `src/features/admin/moderationDecisionForm.test.ts`
- Create: `src/features/admin/ModerationCasePage.tsx`
- Create: `src/features/admin/ModerationCasePage.test.tsx`
- Modify: `src/styles.css`

1. Add failing tests for all auth/admin gates, loading/not-found/error/retry,
   exact report/account presentation, zero/three evidence controls, explicit
   evidence load, Blob cleanup, rationale validation, accessible dismissal/
   confirmation dialog, focus restoration, pending single-flight, stale async
   guards, exact trusted result rendering, reload terminal state, and
   eligibility-without-suspend-action.
2. Implement the detail page and confirmation dialog. Render no raw Storage
   path/hash/generation, contact, or email. Never optimistically increment a
   count and never add a suspension control.
3. Run focused component tests to GREEN.
4. Commit `feat: review and decide moderation cases`.

## Task 11: Connect strict routes and admin navigation

**Files:**

- Modify: `src/route.ts`
- Modify: `src/route.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/features/auth/AuthStatus.tsx`
- Modify: `src/features/auth/AuthStatus.test.tsx`

1. Add failing tests for exact `#/admin/moderation` and
   `#/admin/moderation/:reportId` parsing; malformed/encoded/slashed/oversized
   IDs; page dispatch; admin-only `審查檢舉` navigation; and disappearance on
   claim/account/identity change.
2. Add strict route helpers before generic Listing/default matching and render
   the queue/detail pages. Keep Card Master navigation separate.
3. Run focused route/App/AuthStatus tests to GREEN.
4. Commit `feat: connect moderation admin routes`.

## Task 12: Lock case and evidence boundaries in Rules

**Files:**

- Modify: `firestore.rules`
- Modify: `storage.rules`
- Modify: `src/rules/firebaseRules.test.ts`

1. Add failing Emulator tests proving every browser read/write/list to
   `moderationCases` fails for anonymous, ordinary, suspended, malformed, and
   admin-claim clients. Re-prove report/account/evidence privacy and draft-owner
   evidence uploads so no admin browser exception weakens existing Rules.
2. Add the minimal explicit server-only case match and leave Storage read rules
   unchanged.
3. Run Rules Emulator tests to GREEN.
4. Commit `security: isolate moderation cases`.

## Task 13: Verify admin moderation end to end

**Files:**

- Modify: `e2e/support/emulator-state.ts`
- Modify: `e2e/support/emulator-state.spec.ts`
- Create: `e2e/admin-moderation.spec.ts`
- Modify: `e2e/report-tickets.spec.ts`
- Modify: `e2e/mobile-forms.spec.ts`

1. Extend exact guarded seeds/reads for open/dismissed/confirmed cases and
   account counts. Add only demo-Emulator evidence helpers.
2. Prove report submit creates one open case; active admin navigation, filtering,
   detail, explicit evidence display, dismissal, confirmation, reload, count
   one/two, and eligibility without suspension.
3. Prove ordinary/signed-out/suspended/malformed admin denial, direct case/report
   and evidence reads denied, malformed pairs fail, exact retry does not
   double-count, conflicting/concurrent decisions fail, and no Auth/Listings/
   contacts/email are changed.
4. Cover queue/detail/dialog at iPhone width with no horizontal overflow.
5. Run focused Chromium/WebKit files to GREEN.
6. Commit `test: verify admin moderation end to end`.

## Task 14: Document operations and verify Batch 9

**Files:**

- Modify: `docs/firebase-setup.md`
- Modify: `docs/integration-testing.md`
- Modify: `docs/milestones.md`
- Modify: `functions/src/index.test.ts`
- Modify: `scripts/package-contract.test.mjs`

1. Add failing documentation contracts for active-admin boundaries, private
   queue/detail/evidence, immutable/idempotent decisions, atomic count updates,
   no automatic suspension/email/migration, Functions → indexes → Rules →
   frontend, non-invasive verification, monitoring, rollback, and
   repository-ready/not-production-live status.
2. Run all frontend, script, Functions, lint/build, Rules, Chromium/WebKit,
   production build, diff, and status gates under Node 22. Never source a
   production credential environment for Emulator tests.
3. Audit all admin routes, callable adapters, Firestore/Storage paths, fields,
   Blob URL cleanup, logs, and count writes. Map all ten acceptance criteria to
   test evidence.
4. Commit `docs: add admin moderation runbook` and record that no production
   report/evidence read, decision, count change, email, deploy, or data mutation
   occurred before Batch 10.
