# Batch 10 Account Suspension and Restoration Design

## Purpose

Give an active administrator a deliberate, auditable way to suspend an account
after at least two confirmed violations, hide all of that seller's currently
active Listings, restore the account later, and let the restored seller choose
which held Listings to publish again. Reports and violation counts never suspend
an account automatically.

## Policy and scope

- Suspension and restoration require an authenticated account with exact custom
  claim `admin === true` and canonical active `accountAccess` state.
- The administrator cannot suspend or restore their own UID. This prevents a
  single admin session from removing its own recovery authority.
- Suspension is available only from a confirmed moderation case whose target
  currently has at least two confirmed violations. A required, trimmed
  1–1,000-character reason is distinct from the case rationale.
- Restoration is a separate explicit action with its own required, trimmed
  1–1,000-character reason. It never erases cases, counts, suspension history,
  or Listing holds.
- Suspension immediately removes buyer/seller privileges through
  `accountAccess`. It deliberately does **not** disable the Google/Firebase Auth
  identity or revoke tokens. A suspended person must remain authenticated to see
  the existing read-only Dashboard and, in Batch 11, submit an appeal. Firestore,
  Storage, and trusted Functions remain the authorization boundaries.
- Active Listings are hidden automatically. Sold-out Listings and immutable Sale
  history are unchanged and remain visible to their owner in Dashboard.
- Restoration does not bulk republish anything. A restored seller may edit,
  delete, or individually republish each held Listing. Republishing creates no
  new Listing event and sends no subscription notification.
- No suspension, restoration, or republish email, push, LINE, Facebook, Threads,
  or Discord message is sent in this batch.

## Account and Listing state

The existing active account shape remains unchanged. A suspended account adds
one required server-owned operation reference:

```ts
{
  status: 'suspended';
  confirmedViolationCount: number;
  suspensionReason: string;
  suspendedAt: Timestamp;
  suspendedBy: string;
  suspensionActionId: string;
  updatedAt: Timestamp;
}
```

Missing account access remains compatible active/count-zero state, but cannot be
suspended because it cannot meet the two-confirmation threshold. Restoration
returns the account to the existing exact active shape and preserves the count.

`ListingStatus` gains `suspended`. Only that variant adds:

```ts
{
  status: 'suspended';
  suspensionActionId: string;
  suspendedAt: Timestamp;
}
```

An active or sold-out Listing must omit both hold fields. A held Listing keeps
its complete identity, quantity, prices, images, and timestamps; `updatedAt`
changes when the hold is applied. Public Rules continue to expose only `active`
Listings. The owner can read `suspended` Listings. Sale creation rejects them.
After restoration, existing trusted edit and unsold-delete workflows may accept
the held status without making it public. A successful republish removes both
hold fields, returns the status to `active`, and updates `updatedAt`.

## Resumable suspension operation

Hiding an unbounded number of Listings cannot be atomic with one account write.
Batch 10 therefore uses a fail-closed, resumable operation instead of claiming a
cross-document atomicity guarantee that Firestore cannot provide.

`suspendModerationTarget` accepts exact
`{ reportId, requestId, reason }`. `requestId` is a UUID created once when the
dialog opens and retained for retries. A server-derived key binds it to the
admin, so another principal cannot collide with or replay it.

The first transaction verifies the active admin, confirmed report/case pair,
target count, non-self target, and exact request compatibility. It then:

1. creates `accountModerationOperations/{actionId}` in `hiding` state;
2. changes `accountAccess/{targetUid}` to `suspended` immediately;
3. creates an immutable `suspension_requested` audit event.

The account write prevents every new privileged mutation before Listing hiding
begins. The handler then drains active Listings for the target in deterministic
bounded batches. Each batch changes only still-active Listings to `suspended`
with the same action ID and increments the operation's hidden count. A concurrent
trusted Listing mutation that read account access conflicts or retries and then
fails on suspended state. Browser Listing creation is denied by Rules once the
account document is suspended.

When no active Listing remains, one transaction changes the operation to
`suspended` and creates one deterministic immutable `suspension_completed`
event. Exact retries resume the same operation and never create a second action
or rewrite an already-held Listing. A scheduled
`reconcileAccountModerationOperations` job retries bounded `hiding` operations,
so a callable timeout or process failure cannot silently strand the workflow.
The admin UI presents `停權處理中` until completion and never claims all Listings
are hidden from only the initial account write.

There can be a short, explicitly monitored interval in which the account is
already blocked but a remaining active Listing is still public. This is safer
than leaving the account active and is closed by the in-request drain plus the
scheduled reconciler. Operation age and remaining-active counts are operational
alerts.

## Restoration and selective republishing

`restoreModerationTarget` accepts exact
`{ reportId, suspensionActionId, requestId, reason }`. In one transaction it
verifies the active admin, confirmed case/target, current completed suspension,
operation identity, and request compatibility. It returns account access to the
canonical active shape, marks the operation `restored`, and creates one immutable
`restored` audit event. An exact retry returns the stored result; a stale action,
different request, or conflicting reason fails closed.

Restoration is prohibited while Listing hiding is incomplete. It never changes
Listing documents. This guarantees that restoring access cannot accidentally
republish stale prices, notes, or inventory.

`republishSuspendedListing` accepts exact
`{ listingId, suspensionActionId }` from an authenticated active owner. In one
transaction it verifies the held Listing, owner, completed-and-restored action,
positive remaining quantity, and unchanged action ID; changes the Listing to
the exact active shape; and creates a deterministic immutable
`listing_republished` audit event. An exact retry recognizes that event and
returns success without a second write. Another seller, a suspended owner, a
stale action, malformed Listing, sold-out Listing, or uncompleted restoration is
denied.

Multiple suspension cycles are safe. A later action holds whatever Listings are
active at that time. Older unreleased holds keep their original action IDs; once
the account is active and the corresponding action was restored, the seller may
still choose to republish or delete them.

## Private operation and audit data

`accountModerationOperations` is mutable server-owned workflow state with exact
action, target, source report, actor, reason, status, counts, and timestamps.
`accountModerationAuditLogs` is append-only in application code and contains
strict create-only event variants:

- `suspension_requested`;
- `suspension_completed`;
- `restored`;
- `listing_republished`.

Every event records only the IDs, bounded reason where applicable, trusted
count, and server timestamp needed to reconstruct the action. It contains no
email, contact, Google presentation, report description, case rationale,
evidence, image URL, or image bytes. Firestore Rules deny all browser reads and
writes to both collections, including admin-claim browsers.

`getModerationCase` extends its active-admin response with the current
suspension operation summary and a bounded newest-first target-account audit
history. This gives the administrator a reachable history without exposing the
collections directly. The summary and history use strict allowlisted DTOs.

## UI behavior

The confirmed-case detail page shows:

- `停權帳號` only for a different active target with count at least two;
- a reason dialog with destructive confirmation and stable retry request ID;
- `停權處理中` plus retryable refresh while hiding is incomplete;
- current suspension reason/time/admin and `恢復帳號` for a completed suspension;
- a restoration reason dialog and the bounded audit history.

All actions are single-flight, do not optimistically change state, invalidate
stale route/identity responses, trap dialog focus, support Escape, and restore
focus. Signed-out, non-admin, suspended, unavailable, malformed, ineligible, and
self-target states invoke no suspension/restoration handler.

Dashboard gains `停權隱藏商品`. Suspended sellers see it read-only. Restored
sellers see individual `編輯`, `重新上架`, and eligible `刪除` controls. Republish
is confirmed, single-flight, reloads trusted data, and does not fabricate a
Listing event. Empty, pending, success, and generic retryable failure states are
explicit and usable on mobile.

## Rules, indexes, and privacy

- Browser access to operation/audit collections is always denied.
- Public Listing reads remain `status == active`; owners retain reads of all
  their Listings.
- Browser Listing update/delete remains denied. New suspended fields can only be
  written by trusted Functions.
- Existing active-account gates deny Profile, Listing creation, contact reveal,
  report, subscriptions, Storage writes, edits, Sales, and republish while
  suspended.
- Composite indexes support active Listings by seller for the reconciler,
  bounded pending operations, and target audit history.
- No callable returns contact, email, evidence, report body, Storage path, image
  bytes, or unrelated account data through this workflow.

## Error, concurrency, and recovery behavior

- Strict parsers reject unknown fields, malformed timestamps, mismatched IDs,
  impossible status/hold combinations, and counts outside safe integer bounds.
- Error messages reveal no moderation details to non-admins. Logs contain only
  sanitized operation labels/codes and bounded aggregate counts.
- Suspension request replay is idempotent by admin-bound request key. A
  conflicting request ID or a changed reason fails closed.
- Only one active suspension operation may own an account. Restoration and
  republish transactions verify its exact action ID.
- A moderation confirmation racing suspension serializes on account access; the
  suspension sees the final count or retries.
- A restoration racing the reconciler is impossible because restore requires a
  completed operation. A republish racing a later suspension serializes on the
  Listing and account reads; the resulting Listing is either held by the later
  action or remains safely non-public.
- Rollback never deletes audit records, decrements violation counts, or blindly
  republishes Listings.

## Release and operations

This workflow is additive and requires no data migration. Existing active and
sold-out Listings retain their exact shapes. A separately approved release uses
**Functions → indexes → Rules → frontend**. Wait for required indexes and the
scheduled reconciler manifest before exposing admin actions.

Production verification is non-invasive: inspect deployed versions, index
readiness, schedule presence, aggregate sanitized operation states, error rates,
and Rules versions. It must not suspend or restore a production account, hide or
republish a production Listing, read a production moderation record, send email,
or mutate production data merely as a probe.

Monitor old `hiding` operations, remaining-active counts, per-action hidden
totals, completion latency, transaction conflicts, malformed-state failures,
permission denials, restore/republish outcomes, and unexpected Marketplace
volume changes. Rollback removes frontend actions first, retains private Rules
and audit data, and keeps the reconciler until every started hide operation is
complete. Prefer a compatible roll-forward. Any manual repair, account change,
Listing publication, audit change, deployment, or rollback requires separate
explicit approval.

## Explicitly deferred

- Seller appeal submission, appeal evidence, admin appeal decisions, and any
  reversal/remedy policy (Batch 11).
- Automatic suspension, violation decay, count reduction, bulk republishing,
  replacement-account detection, fraud scoring, OCR, and automated moderation.
- Reporter/seller case messaging and moderation notifications.
- Firebase Auth disablement/token revocation; changing this policy would require
  a separate design that preserves authenticated read-only history and appeals.

## Acceptance criteria

1. Only an active exact-claim non-target admin can suspend an eligible target
   from a confirmed case with a valid reason.
2. The first suspension transaction blocks account privileges and durably opens
   one admin-bound idempotent hide operation plus immutable request audit.
3. Bounded in-request and scheduled reconciliation eventually hide every active
   target Listing without changing sold-out Listings, Sales, images, or counts.
4. Exact suspension retries resume one action; concurrency, stale IDs, malformed
   state, and conflicting retries fail closed.
5. Restoration requires a completed exact suspension and atomically returns only
   account access to active while preserving counts, holds, cases, and history.
6. A suspended authenticated seller retains the read-only Dashboard but cannot
   perform any privileged buyer/seller or Storage mutation.
7. After restoration, only the owner can individually edit, delete, or republish
   held Listings; republish is idempotent and emits no Listing event.
8. Admin detail and seller Dashboard expose the approved operation/history and
   held-Listing UI without direct access to private operation/audit collections.
9. Rules, strict DTOs, logs, and routes expose no contact, email, report body,
   evidence, audit collection, or hidden Listing to an unauthorized principal.
10. Unit, Rules, Chromium, and mobile WebKit tests prove suspend → complete hide
    → read-only seller → restore → selective republish, retries, failures,
    concurrency, audit history, and zero production mutation.
