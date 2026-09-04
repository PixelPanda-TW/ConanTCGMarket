# Batch 9 Admin Moderation Review Design

## Purpose

Turn each submitted Batch 8 report into a private, auditable moderation case
that an active administrator can review, dismiss, or confirm. A confirmation
atomically increments the target account's confirmed-violation count. Reports
never decide an outcome by themselves, and reaching the suspension threshold
does not suspend an account in this batch.

## Scope and policy

- Only an authenticated account with exact Firebase custom claim
  `admin === true` and canonical active account access may use moderation
  operations or UI. A stale admin token cannot bypass a suspended or malformed
  `accountAccess` document.
- Every newly submitted report owns exactly one case with the same document ID.
  The case begins `open` and has one irreversible Batch 9 terminal decision:
  `dismissed` or `confirmed`.
- A dismissal records a required rationale and does not create or change the
  target's account-access record.
- A confirmation records a required rationale and increments
  `confirmedViolationCount` exactly once in the same Firestore transaction that
  closes the case.
- A missing target `accountAccess/{uid}` is the compatibility form of an active
  account with zero violations. Its first confirmed case creates a canonical
  active record with count one. Canonical active or suspended records retain
  their status fields while their count increments. Malformed records fail
  closed without deciding the case.
- Two or more confirmed violations make the account `suspensionEligible` in the
  admin presentation. This is advisory only. There is no automatic suspension,
  Auth disablement, token revocation, Listing hiding, or restoration in Batch 9.
- Reports, cases, reporter identity, descriptions, evidence, rationales, and
  violation counts remain private. No reporter, seller, or public status/history
  UI is added.
- No report email, seller notification, reporter notification, Discord message,
  or push notification is sent.

## Case creation and compatibility

`submitModerationReport` will atomically write the immutable submitted report
and `moderationCases/{reportId}`. This branch is repository-ready but has never
been released to production, so there are no production submitted reports to
migrate. The case write is create-only; an unexpected pre-existing case aborts
submission instead of guessing ownership or state.

An open case has the exact shape:

```ts
{
  status: 'open';
  reportId: string;
  targetSellerId: string;
  openedAt: Timestamp; // identical to the report submittedAt
}
```

A dismissed case retains those fields and adds:

```ts
{
  status: 'dismissed';
  rationale: string;
  decidedBy: string;
  decidedAt: Timestamp;
}
```

A confirmed case additionally stores the resulting violation count:

```ts
{
  status: 'confirmed';
  rationale: string;
  decidedBy: string;
  decidedAt: Timestamp;
  resultingConfirmedViolationCount: number;
}
```

The rationale is trimmed plain text from 1 to 1,000 characters. Terminal cases
are immutable in this batch. An exact retry of the same admin, decision, and
rationale returns the stored result; a conflicting retry fails closed. The
case itself is the durable decision audit record, so no independently written
audit log can drift away from the decision transaction.

## Trusted Functions

### `listModerationCases`

Accepts `{ status, limit, cursor }`, where status is `open`, `dismissed`,
`confirmed`, or `all`; limit defaults to 20 and is bounded to 1–50; and a cursor
contains the previous case's `openedAt` milliseconds plus document key. The
Admin SDK queries cases in deterministic descending `openedAt`, document-ID
order and fetches the corresponding reports in a bounded operation.

It returns summary rows only: case/report ID, case status, category, target
seller UID, safe Listing snapshot, opened time, decision time when present, and
the resulting count when confirmed. It does not return description, reporter
UID, evidence metadata, rationale, contact, email, or Google profile data.
Malformed or missing paired data fails the page rather than returning a
plausible partial record.

### `getModerationCase`

Accepts exact `{ reportId }` and returns one detailed admin DTO containing the
case decision, rationale when decided, immutable report category/description,
reporter UID, target seller UID, safe Listing snapshot, submitted time,
sanitized evidence entries `{ slot, contentType, size }`, and an account summary
`{ status, confirmedViolationCount, suspensionEligible }`. It never returns a
Storage path, generation, hash, contact, email, Google display name, signed URL,
or unrelated account fields.

### `getModerationEvidence`

Accepts exact `{ reportId, slot }`. After repeating the active-admin check, it
loads the submitted report and case, resolves only the recorded canonical slot,
verifies current Storage metadata still matches the immutable recorded
generation, MIME type, and size, then downloads that one object. The response is
exactly `{ contentType, size, dataBase64 }` and is capped by the existing 5 MiB
evidence limit. The UI creates a short-lived local Blob URL and revokes it on
replacement, close, identity change, and unmount. This authenticated endpoint
avoids public or bearer signed URLs and preserves the Storage no-read rule.

### `decideModerationCase`

Accepts exact `{ reportId, decision, rationale }`. Decision is `dismissed` or
`confirmed`. In one transaction it verifies the case/report pair and target,
checks an open or identical terminal case, validates the target account state,
then writes the terminal case. Confirmation also creates or updates the exact
account-access record in that same transaction. Dismissal never writes account
access. The response contains the terminal status, resulting count, and
`suspensionEligible`; it contains no report body or identity beyond report ID.

Every callable uses bounded reads, strict exact-field parsing, sanitized error
codes, and no request body, description, rationale, reporter ID, evidence data,
or account details in logs.

## Admin UI and routes

The active-admin navigation adds `審查檢舉`, separate from `管理卡片資料`.
`#/admin/moderation` renders the queue and
`#/admin/moderation/:reportId` renders a reload-safe detail page. Both routes
use strict 1–200-character alphanumeric, underscore, or hyphen IDs where an ID
is present and are protected independently by the UI and callable checks.

The queue provides status tabs, deterministic pagination, loading, empty,
retryable error, and stale-result handling. Each summary shows only approved
safe fields and links to its detail route.

The detail page shows the full report, case history, target account summary,
and zero to three evidence controls. Evidence loads only after an explicit admin
action, exposes accessible loading/error states, and is never placed in browser
storage. An open case offers `駁回檢舉` and `確認違規`; either opens a confirmation
dialog requiring rationale. Pending actions are single-flight. Closing or
confirming restores focus, identity/route changes invalidate stale results, and
success replaces the open controls with the durable decision. A count of two or
more shows that manual suspension is eligible but provides no suspension button
until Batch 10.

Signed-out, non-admin, suspended, claim-unavailable, and account-unavailable
states never load moderation data or evidence and never invoke a decision.

## Firestore, Storage, and indexes

- `moderationCases` is server-only for every browser, including admins.
- Existing server-only rules for reports, request keys, limits, account access,
  and evidence remain unchanged.
- Case list indexes support status plus descending `openedAt` and document ID;
  the all-status path uses the corresponding unfiltered ordering.
- Evidence remains unreadable through the Storage SDK. Only the trusted
  evidence callable can return one verified object to an active admin.
- Submitted report and evidence cleanup behavior is unchanged; cleanup never
  deletes a case, submitted report, or submitted evidence.

## Concurrency, idempotency, and error behavior

- Concurrent decisions serialize on `moderationCases/{reportId}`. Exactly one
  differing decision can succeed.
- Retrying an identical confirmation cannot increment the count twice.
- A missing, draft, expired, malformed, or target-mismatched report/case pair
  fails without any write.
- UI service errors are generic. Field validation may identify rationale length.
  Authorization errors never reveal whether a case, report, user, or evidence
  object exists.
- The admin page never optimistically changes a violation count. It renders only
  the trusted transaction response or a subsequent server reload.

## Release and operations

The feature is additive and needs no production data migration because Batch 8
has not been released. A future separately approved release order is
**Functions → indexes → Rules → frontend**. Functions must understand both the
submission-created case and the admin operations before the route becomes
reachable. Production verification is non-invasive: inspect manifests, index
readiness, Rules release, frontend version, and aggregate sanitized metrics. It
must not submit or decide a real report, read real evidence, change a violation
count, send email, or mutate production data merely as a probe.

Monitor queue/list/detail/decision error rates, confirmation/dismissal totals,
transaction conflicts, malformed-pair failures, evidence metadata mismatches,
response size/latency, and permission denials without logging report content.
Rollback removes the frontend routes first while keeping private Rules. Preserve
all reports/cases/evidence. Roll back Functions only to a version that still
understands case creation; never delete cases or decrement counts as rollback.
Every production release, rollback, repair, or data mutation requires separate
explicit approval.

## Explicitly deferred

- Manual suspension/restoration, Firebase Auth disablement or token revocation,
  Listing hide/republish selection, and their audit events (Batch 10).
- Seller appeals, admin appeal decisions, and any reversal policy (Batch 11).
- Reporter status/history, seller case details, comments, messaging, and
  duplicate-report merging.
- Automated moderation, automatic suspension, fraud scoring, OCR, image or text
  analysis, and replacement-account detection.
- Email, push, LINE, Facebook, Threads, or Discord moderation notifications.

## Acceptance criteria

1. Every successful new report submission atomically creates one exact open case;
   conflicting pre-existing case state aborts the submission.
2. Only an active exact-claim admin can list, inspect, load evidence, or decide;
   direct browser Firestore/Storage access remains denied for everyone.
3. The queue supports all/open/dismissed/confirmed filters, bounded deterministic
   pagination, and safe summaries without report bodies or reporter identity.
4. Detail returns the exact private report, decision, evidence summaries, and
   account count without contact, email, Storage paths, hashes, or extra fields.
5. Admin evidence retrieval verifies the recorded object and returns only one
   approved object through the authenticated callable; local Blob URLs are
   revoked and never persisted.
6. Dismissal records one immutable rationale-backed decision and never changes
   account access or violation count.
7. Confirmation atomically records one immutable decision and increments a
   missing, active, or suspended target's count exactly once; malformed state
   causes no writes.
8. Identical decision retries are idempotent, conflicting/concurrent decisions
   fail closed, and the UI never presents an untrusted optimistic count.
9. Two confirmed violations expose suspension eligibility but never automatically
   suspend, disable Auth, hide Listings, or expose a Batch 10 action.
10. Emulator Rules and browser E2E prove queue → detail → evidence → decision,
    reload persistence, privacy, denial paths, and no production mutation.
