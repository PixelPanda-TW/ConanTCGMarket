# Batch 11 Account Appeals Design

## Purpose

Give an authenticated suspended account one private, auditable path to ask for
review, let an active exact-claim administrator inspect the appeal and its
evidence, and resolve it without weakening the suspension, Listing-hold, or
moderation-history guarantees established in Batches 8–10.

## Policy

- An appeal belongs to one exact `suspensionActionId` and the suspended target
  UID. It is not a general report, support inbox, or conversation thread.
- The suspended person may have at most one submitted appeal for a suspension
  action. Exact submission retries are idempotent; a second submission or an
  appeal for an old action is rejected.
- The appeal requires a trimmed 100–2,000-character statement and accepts zero
  to three JPEG, PNG, or WebP evidence images, each at most 5 MiB.
- Submission is the sole privileged mutation available to a suspended account.
  It does not change account access, Listings, Sales, cases, counts, or audits.
- An active account with exact custom claim `admin === true` reviews appeals.
  The target cannot review their own appeal even if they have an admin claim.
- The admin must supply a trimmed 1–1,000-character rationale and chooses
  `dismissed` or `approved`. Decisions are final and immutable in this batch.
- Dismissal leaves the suspension unchanged. Approval restores the account by
  the same invariants as Batch 10, but never decrements violation counts,
  deletes cases/history, or republishes held Listings.
- No email, push, LINE, Facebook, Threads, or Discord message is sent.

## Data model and privacy

`accountAppeals/{appealId}` is server-owned and private. The deterministic ID is
derived from the suspension action, not supplied as an authorization decision.
Its exact variants are:

```ts
type AccountAppeal =
  | {
      status: 'submitted';
      targetUid: string;
      suspensionActionId: string;
      statement: string;
      evidenceCount: number;
      submittedAt: Timestamp;
      updatedAt: Timestamp;
    }
  | {
      status: 'dismissed' | 'approved';
      targetUid: string;
      suspensionActionId: string;
      statement: string;
      evidenceCount: number;
      submittedAt: Timestamp;
      decidedAt: Timestamp;
      decidedBy: string;
      decisionRationale: string;
      updatedAt: Timestamp;
    };
```

`accountAppealAuditLogs` is append-only server data with deterministic
`appeal_submitted`, `appeal_dismissed`, and `appeal_approved` events. It stores
only bounded identifiers, actor, outcome, rationale where needed, and server
timestamps. It contains no email, contact, statement, image URL, Storage path,
or image bytes.

Evidence uses private Storage paths
`account-appeal-evidence/{targetUid}/{suspensionActionId}/{draftId}/{slot}`.
Browser Rules allow only the authenticated target whose current canonical state
is suspended by that exact action to upload/delete a bounded draft object.
There is no browser read. The submit Function validates object existence,
generation, size, MIME type, count, exact owner/action/draft path, and then binds
the immutable references to the appeal. Submitted evidence cannot be changed or
deleted by the browser. Admin retrieval uses a callable that rechecks active
exact-claim authorization and returns bytes for one allowlisted object; URLs and
paths are never exposed to the client.

Firestore Rules deny all browser reads and writes to appeals and appeal audit
logs. A suspended owner sees their own allowlisted appeal DTO only through
`getOwnAccountAppeal`; an admin uses bounded callable projections. Direct
collection access is never an alternative UI path.

## Seller flow

Dashboard shows an `申訴停權` panel only for a canonical suspended state. It
loads the appeal for the current suspension action and presents explicit
loading, unavailable, not-submitted, submitted, dismissed, and approved states.
The form validates the statement and evidence locally, uploads draft evidence,
then calls `submitAccountAppeal` with exact
`{ suspensionActionId, requestId, draftId, statement, evidence }`.

The request ID is created once when submission begins and retained across safe
retries. The Function transaction rereads account state and the completed
suspension operation, rejects stale or malformed state, creates one appeal and
one immutable audit event, and returns a strict DTO. The UI does not optimistically
claim submission and reloads trusted state after success.

Draft uploads are replaceable before submission. Leaving the form does not
silently submit. A scheduled bounded cleanup removes only expired unsubmitted
draft evidence after 24 hours; it never deletes submitted evidence.

## Admin flow and remedy

The existing private moderation area gains an appeals queue and detail route.
The queue is newest-first, bounded, cursor-paginated, and filterable by
`submitted`, `dismissed`, or `approved`. It exposes only appeal ID, status,
target UID, action ID, evidence count, and timestamps. The detail adds the
statement and decision fields, plus bounded evidence retrieval controls.

`decideAccountAppeal` accepts exact
`{ appealId, requestId, decision, rationale }`. A transaction verifies the
active non-target admin, submitted appeal, exact current suspension action, and
completed suspension operation. Dismissal atomically changes only the appeal
and creates its audit event. Approval atomically marks the appeal approved,
restores `accountAccess` to the canonical active shape, marks the Batch 10
operation restored, and creates both the appeal decision event and the existing
restoration audit event. The appeal ID is the restoration source and the admin
rationale is the restoration reason.

Exact retries return the stored decision. Reusing a request ID with different
input, concurrent decisions, stale actions, malformed data, self-review, or an
already-restored target fail closed. Approval never calls a looser secondary
restore path and never changes any Listing.

## Errors, concurrency, and abuse limits

- Parsers reject unknown fields, unsafe counts, invalid timestamps, unexpected
  status fields, noncanonical evidence metadata, and mismatched identities.
- Submission is limited to five attempts per target per UTC day; exact retries
  do not consume an additional slot. Since only one appeal can be submitted per
  action, the counter mainly bounds rejected/stale abuse.
- Queue/detail/evidence errors reveal no appeal existence to unauthorized users.
  User-facing errors are generic; logs contain sanitized operation codes and
  aggregate counts only.
- Suspension action identity serializes a new suspension against appeal review.
  A decision for an older action can never restore a newer suspension.
- Admin responses are single-flight, do not optimistically mutate state, and
  invalidate stale route or identity responses.

## Release and operations

This feature is additive and needs no migration. Release order after all local
gates and separate production approval is **Functions → indexes → Rules →
frontend**. Wait for appeal queue indexes, scheduled cleanup manifest, and
private Storage/Firestore Rules before exposing either UI.

Production verification is non-invasive. It may inspect versions, manifests,
index readiness, schedule presence, Rules releases, and aggregate sanitized
metrics. It must not read or create a production appeal, upload/read production
evidence, decide an appeal, restore an account, republish a Listing, send email,
or mutate production data as a probe.

Monitor submission and decision result counts, stale-action conflicts, malformed
records, cleanup failures, evidence retrieval failures, permission denials, and
approval-to-restoration consistency. Rollback removes frontend entry points
first and retains Functions/Rules needed to finish an already-started decision.
Never delete appeals, evidence, audits, cases, operations, or counts as rollback.
Prefer a compatible roll-forward. Every production deploy, decision, evidence
access, repair, rollback, or data mutation requires separate explicit approval.

## Out of scope

- Comments, chat, reporter participation, repeated appeals, decision reversal,
  SLA promises, or public appeal status.
- Automatic decisions, count decay/reduction, bulk Listing republish, Firebase
  Auth disablement, replacement-account detection, OCR, or fraud scoring.
- Moderation email or other external notification.

## Acceptance criteria

1. Only the currently suspended authenticated target can draft and submit one
   appeal for the exact completed suspension action.
2. Statement, request, evidence, MIME, size, count, generation, and path data are
   strictly validated, bounded, private, and idempotent.
3. Submission changes no account, Listing, Sale, case, count, or prior audit.
4. Only an active exact-claim non-target admin can list, inspect, retrieve
   evidence for, dismiss, or approve an appeal.
5. Dismissal preserves suspension; approval atomically reuses Batch 10 restore
   invariants and preserves every hold, count, case, and history record.
6. Exact retries are idempotent; concurrent, conflicting, stale, self-review,
   malformed, and cross-user operations fail closed.
7. Browser Rules deny appeal/audit reads and writes and deny submitted evidence
   access, while allowing only exact suspended-owner draft uploads.
8. Seller and admin UI expose complete reachable loading, empty, success,
   decision, retry, responsive, keyboard, and reload states.
9. Cleanup removes only expired unsubmitted draft evidence and all DTOs/logs
   exclude contact, email, raw paths, URLs, and unrelated moderation data.
10. Unit, Rules, Chromium, and iPhone WebKit tests prove the complete submit →
    private review → dismiss/approve → restored-read-only-holds workflow with no
    production operation.
