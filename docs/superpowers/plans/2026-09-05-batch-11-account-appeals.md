# Batch 11 Account Appeals Implementation Plan

> Implement in order. Every production change follows a witnessed focused RED
> test, the smallest GREEN change, refactor under green tests, and a task commit.
> Never deploy, inspect production moderation data, or perform a production
> appeal, evidence, account, Listing, email, or rollback operation.

**Goal:** Implement one private appeal per suspension action, private optional
evidence, active-admin review, dismissal, and approval that atomically reuses
the Batch 10 restoration invariants without reducing counts or republishing.

**Architecture:** Pure strict domain modules define appeal/evidence/decision
states. Trusted callable adapters own Firestore appeal/audit documents and admin
evidence reads. Storage Rules permit only exact suspended-owner draft uploads;
Firestore Rules deny all appeal/audit browser access. Dashboard and private admin
routes consume allowlisted callable DTOs. Approval shares the account-moderation
restoration core transaction rather than duplicating a weaker remedy.

**Stack:** React 19, TypeScript, Firebase Auth/Firestore/Storage/Functions,
Vitest, Firebase Rules Emulator, Playwright Chromium and iPhone WebKit.

## Task 1: Domain contract

**Files:** add `src/domain/models/accountAppeal.ts` and test; add
`functions/src/accountAppeals.ts` and test.

- RED: exact variants, DTO projections, text bounds, IDs, timestamps, evidence
  metadata, unknown fields, decision transitions, and sanitized errors.
- GREEN: pure parsers/builders only; no Firebase adapter.
- Verify focused web and Functions tests.
- Commit: `feat: define account appeal contracts`.

## Task 2: Evidence draft rules

**Files:** `storage.rules`, `tests/storage.rules.test.ts`, appeal test helpers.

- RED: deny anonymous/active/other-user reads and writes; permit only canonical
  suspended target draft create/update/delete for exact action, slot, MIME and
  size; deny all browser reads and every submitted/non-draft path.
- GREEN: add the narrow Storage rule using canonical `accountAccess` lookup.
- Verify focused Rules suite.
- Commit: `security: isolate account appeal evidence`.

## Task 3: Firestore privacy and indexes

**Files:** `firestore.rules`, `firestore.indexes.json`, Rules tests.

- RED: appeal, appeal audit, request, and rate-limit collections reject every
  browser principal including admin claim; required queue indexes are declared.
- GREEN: explicit deny blocks and bounded composite indexes.
- Verify focused Rules and index contract tests.
- Commit: `security: protect account appeal records`.

## Task 4: Seller submission core

**Files:** `functions/src/accountAppeals.ts` and tests.

- RED: exact suspended owner/action, completed suspension, one appeal, request
  idempotency/conflict, statement bounds, evidence generation/path/MIME/size,
  UTC-day limit, immutable audit, and zero unrelated writes.
- GREEN: dependency-injected submit use case and deterministic IDs.
- Verify focused Functions tests.
- Commit: `feat: submit account appeals`.

## Task 5: Seller callable adapters

**Files:** `functions/src/index.ts`, `functions/src/index.test.ts`, Functions
package contracts.

- RED: `getOwnAccountAppeal` and `submitAccountAppeal` authenticate, preserve
  suspended access exception only here, validate Storage metadata, convert Admin
  Timestamps, use transactions, and return strict DTOs.
- GREEN: export both callables with sanitized logs and App Check observation.
- Verify focused and full Functions tests.
- Commit: `feat: expose seller appeal functions`.

## Task 6: Draft cleanup

**Files:** add `functions/src/appealCleanup.ts` and test; update `index.ts` tests.

- RED: bounded scheduled cleanup deletes only >24-hour unsubmitted draft
  objects, skips bound/submitted/current objects, handles pagination and retries,
  and logs no paths or identities.
- GREEN: pure planner plus five-minute scheduled adapter.
- Verify focused Functions tests and manifest contract.
- Commit: `feat: clean expired appeal drafts`.

## Task 7: Frontend repository

**Files:** add `src/data/firestore/repositories/accountAppealRepository.ts` and
test; update repository exports and Firebase callable wiring.

- RED: get/submit/upload/replace/remove operations use exact payloads, stable
  request/draft IDs, bounded slots, no raw path leakage, and strict DTO parsing.
- GREEN: minimal repository and typed error mapping.
- Verify focused web tests.
- Commit: `feat: connect account appeal data`.

## Task 8: Suspended seller appeal UI

**Files:** add `src/features/appeals/AccountAppealPanel.tsx`, form helpers, tests;
update `DashboardPage.tsx` tests and styles.

- RED: only canonical suspended owner sees the panel; complete loading/form,
  validation, evidence preview/remove, single-flight submit, retry, submitted,
  dismissed, approved, reload, focus, and mobile states; no other suspended
  mutation becomes reachable.
- GREEN: accessible panel using existing tokens and repository injection.
- Verify focused component tests and build.
- Commit: `feat: let suspended users submit appeals`.

## Task 9: Admin review core

**Files:** extend `functions/src/accountAppeals.ts` and tests; minimally extract
shared restoration primitive from `accountModeration.ts` with unchanged tests.

- RED: bounded cursor queue/detail/evidence DTOs; active exact-claim non-target
  admin; dismissal; approval atomically restores exact action, marks operation,
  writes both audits, preserves counts/holds; retries/concurrency/stale/malformed
  state fail closed.
- GREEN: dependency-injected list/get/evidence/decide cases and shared strict
  restoration transaction builder.
- Verify both appeal and account-moderation Functions tests.
- Commit: `feat: review and decide account appeals`.

## Task 10: Admin callable adapters

**Files:** `functions/src/index.ts`, `functions/src/index.test.ts`.

- RED: `listAccountAppeals`, `getAccountAppeal`, `getAccountAppealEvidence`, and
  `decideAccountAppeal` enforce auth/account/claim, bounded reads, Admin Timestamp
  conversion, private byte response, sanitized logging, and exact error mapping.
- GREEN: export adapters without exposing URL/path/email/contact.
- Verify focused and full Functions tests.
- Commit: `feat: expose admin appeal review functions`.

## Task 11: Admin repository and routes

**Files:** add admin appeal repository/tests and admin queue/detail pages/tests;
update `src/App.tsx`, `App.test.tsx`, admin navigation and styles.

- RED: private claim/account route gate, reachable queue/detail, filters,
  pagination, evidence, rationale dialogs, single-flight dismiss/approve, generic
  errors, reload, stale-response invalidation, focus/Escape, and responsive UI.
- GREEN: strict repository and lazy private routes using existing moderation UI
  patterns.
- Verify focused component/App tests and build.
- Commit: `feat: add admin appeal review ui`.

## Task 12: E2E and direct security proof

**Files:** add `e2e/account-appeals.spec.ts`; extend E2E support and mobile specs.

- RED/GREEN test-only cycle: seed strict action/appeal/evidence/audit data and
  prove submit with 0/3 images, reload, one-per-action, privacy, direct Rules
  denial, admin queue/detail/evidence, dismissal, approval, restored account with
  held Listings, no republish/count loss, retries, malformed/stale/self/ordinary
  denial, cleanup handler, and mobile layout.
- Run focused Chromium and WebKit.
- Commit: `test: verify account appeals end to end`.

## Task 13: Operations documentation

**Files:** `docs/firebase-setup.md`, `docs/integration-testing.md`,
`docs/milestones.md`, docs contract tests.

- RED: docs must state one appeal/action, private evidence, manual immutable
  decisions, approval reuse of restore, no count reduction/republish/email/
  migration, cleanup safety, release order, non-invasive verification,
  monitoring/rollback, and repository-ready/not-live status.
- GREEN: add operator runbook and ten acceptance mappings.
- Verify docs contracts.
- Commit: `docs: add account appeal runbook`.

## Task 14: Full release gate

Run with Node.js 22:

1. `npm test` with repository Firebase build environment;
2. `npm run test:scripts`;
3. `npm run test:functions`;
4. `npm --prefix functions run lint`;
5. `npm run build:functions`;
6. production `npm run build` with repository environment;
7. `npm run build:e2e` without production environment;
8. `npm run test:rules`;
9. `npm run test:e2e:chromium`;
10. `npm run test:e2e:webkit`;
11. `git diff --check` and clean scoped status.

Do not run deploy, production smoke that reads moderation data, a claim command,
or any production appeal/evidence/account/Listing operation. Fix failures using
systematic debugging, rerun the affected gate, then rerun any downstream gate
whose evidence was invalidated.
