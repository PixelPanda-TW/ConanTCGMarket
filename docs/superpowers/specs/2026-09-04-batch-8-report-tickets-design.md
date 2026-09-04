# Batch 8 Report Tickets Design

## Purpose

Allow an active Google-authenticated user to submit a structured report about
another seller's active Listing, with an optional set of evidence images. The
report becomes a durable, server-owned moderation queue item for Batch 9. This
batch does not decide reports, change violation counts, suspend accounts, or
send production email.

## Scope and user policy

- Guests may browse Listings. Selecting `檢舉商品` asks them to sign in with
  Google and keeps the Listing context.
- Any active Google account is a valid reporter; a Seller Profile is not
  required.
- Suspended or unresolved accounts cannot create, upload, submit, or delete
  ordinary report evidence.
- A user cannot report a Listing they own.
- A report can start only from an active Listing. If the Listing later changes
  or disappears, an already-created draft keeps its immutable safe snapshot and
  may still be submitted before expiry.
- Report categories are `suspected_counterfeit`, `listing_mismatch`,
  `fraud_or_harassment`, `prohibited_content`, and `other`.
- Description is required, trimmed, and 1–100 characters. It is plain text.
- Evidence is optional: zero to three JPEG, PNG, or WebP images, at most 5 MiB
  each. No video, PDF, remote URL, EXIF-dependent behavior, or arbitrary file.
- A successful submission shows an opaque ticket reference. There is no public
  report feed and no reporter status/history page in this batch.

## Routes and UI

The Listing page renders `檢舉商品` only for a non-owner active Listing. A guest
may see the entry point and receives Google sign-in guidance after invoking it.
An authenticated active user navigates to `#/listing/:listingId/report`.

The report page:

1. loads the current Listing for context;
2. shows safe card and seller presentation data only;
3. collects one category, the bounded description, and zero to three images;
4. creates an upload draft only when the user submits a locally valid form;
5. uploads evidence, finalizes the ticket, and shows the reference;
6. prevents duplicate submission while pending and ignores stale async results
   after identity or route changes.

If draft creation succeeds but a later upload/finalization fails, the page keeps
the draft reference for a retry during that mounted user/context. Successfully
uploaded draft evidence may be replaced or removed before finalization. After
submission, evidence becomes immutable to the browser.

## Trusted workflow

### `createModerationReportDraft`

An authenticated callable accepts `{ requestId, listingId }`.

- `requestId` is a client-generated UUID used only for retry idempotency.
- The Function checks canonical active account state, an active Listing, and
  `listing.sellerId !== request.auth.uid`.
- It atomically enforces a maximum of 10 newly-created drafts per reporter per
  UTC date. A retry with the same request ID returns the same compatible draft
  without incrementing the limit.
- It creates a 24-hour draft with an immutable safe Listing snapshot and returns
  only `{ reportId, expiresAt }`.

### Evidence upload

Objects use the exact path
`reportEvidence/{reporterUid}/{reportId}/{slot}`, where slot is `0`, `1`, or
`2`. Storage Rules require the authenticated active account to match
`reporterUid`, require a corresponding unexpired `draft` report owned by that
UID, allow only the approved MIME types and 5 MiB maximum, and deny reads.
Draft owners may create, replace, or delete their three draft slots. Once the
report is submitted, all browser writes are denied.

### `submitModerationReport`

An authenticated callable accepts
`{ reportId, category, description, evidencePaths }`.

- It verifies active account state, exact draft ownership, unexpired draft,
  category, trimmed description, and zero-to-three unique canonical paths.
- It reads Storage metadata for every claimed path and rejects a missing,
  oversized, or wrong-type object.
- It atomically changes the report from `draft` to `submitted`, stores the
  normalized fields and evidence metadata, and returns the opaque reference.
- Retrying an identical submission is idempotent. Conflicting retries fail
  closed.

No seller contact, reporter email, Google display name, admin identity, IP
address, user agent, image bytes, or signed evidence URL is copied into the
Firestore report.

## Data model

### `moderationReports/{reportId}`

Draft shape:

```ts
{
  status: 'draft';
  requestKey: string; // server-derived HMAC/hash of reporter UID + requestId
  reporterId: string;
  targetSellerId: string;
  listingSnapshot: {
    listingId: string;
    cardType: CardType;
    cardName: string;
    cardId: string;
    rarity: string;
    listingPrice: number;
    createdAt: Timestamp;
  };
  createdAt: Timestamp;
  expiresAt: Timestamp;
}
```

Submitted shape adds exact `category`, `description`, `evidence` metadata, and
`submittedAt`; it retains the immutable draft identity/snapshot. Later batches
may attach a case by ID but must not rewrite the reporter's submission.

### `moderationReportRequestKeys/{requestKey}`

Server-only idempotency pointer containing `reportId`, `reporterId`,
`requestIdHash`, and `createdAt`. Raw client request IDs are not stored.

### `moderationReportLimits/{reporterId_utcDate}`

Server-only exact counter for newly created drafts on one UTC date. It stores
only reporter UID, date, count, and timestamps. The hard limit is 10.

## Cleanup

A daily scheduled Function scans expired drafts in bounded pages. It deletes
only the three canonical evidence slots for each expired draft and then removes
the draft and idempotency pointer. Submitted reports and evidence are never
deleted by this cleanup. Cleanup retries are idempotent and failures are logged
without exposing descriptions or evidence.

## Authorization boundaries

- Browsers cannot read or write `moderationReports`, request keys, counters, or
  future cases through Firestore.
- Callables re-check auth and canonical account access on every operation.
- Storage evidence has no public or authenticated browser read path. Future
  admin retrieval will use a trusted, short-lived mechanism in Batch 9.
- Storage Rules are defense in depth; finalization trusts only server-read
  object metadata, never the client's declared metadata list.
- Admin custom claims play no role in report submission.

## Error and privacy behavior

UI errors are generic and retryable. They do not reveal whether a different
reporter already reported the same Listing, counter values, internal object
metadata, or future moderation state. Validation errors may identify the local
field. Logging uses report/listing IDs and outcome codes, never description,
evidence bytes, seller contact, or reporter email.

## Compatibility and release

No existing Firestore document or Storage object is migrated. All collections,
paths, routes, and Functions are additive. Release order is Functions → Rules →
frontend so the UI never exposes an entry point without its trusted handlers and
evidence boundary. Production verification is non-invasive and must not create a
real report, upload evidence, notify an admin, or mutate production data without
separate explicit approval.

## Explicitly deferred

- Admin report queue, evidence viewing, dismissal, confirmation, and cases.
- Violation-count changes, suspension/restoration, Listing hide/republish.
- Reporter status/history, comments, messaging, and appeals.
- Email/push/Discord notification of reports.
- Automated decisions, duplicate merging, fraud scoring, or text/image analysis.

## Acceptance criteria

1. An active Google user can report another seller's active Listing without a
   Seller Profile; guests receive sign-in guidance.
2. Owners, suspended users, unresolved account states, and sold-out/missing
   Listings cannot create or submit a report.
3. Category and trimmed 1–100-character description are strictly validated in
   UI and Functions.
4. Zero-to-three approved images are accepted through UID/report/slot-scoped
   Storage paths; other types, sizes, counts, reads, and post-submit writes fail.
5. Draft creation is idempotent and enforces 10 new drafts per reporter UTC day.
6. Finalization verifies actual Storage metadata and is idempotent only for an
   identical submission.
7. Reports contain an immutable safe Listing snapshot and no contact/email or
   arbitrary client fields.
8. All report Firestore collections are server-only; evidence is browser-write
   only during the reporter's active draft and never browser-readable.
9. Expired draft cleanup is bounded, retry-safe, and cannot delete submitted
   reports/evidence.
10. Emulator E2E proves UI → draft → evidence → submit → immutable ticket and
    all important denial paths without production report/email/data mutation.
