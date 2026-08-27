# Card Name Substring Subscriptions Design

## Summary

Extend the existing character-only daily email notification feature into a
single card-name subscription system. A signed-in buyer selects a complete
card name from Card Master. Every newly created Listing whose stored
`cardName` contains that selected name is eligible for the buyer's next daily
email digest, regardless of card type, visible card ID, or rarity.

This replaces the existing `characterKeys` subscription contract. There are
no production users to migrate; existing subscription documents are test data
and may be treated as invalid until they are saved again through the new UI.

## Goals

- Allow one complete Card Master name to subscribe across Character, Partner,
  Event, and Case Listings.
- Match all visible IDs and all rarities when the Listing name contains the
  subscribed name.
- Keep one daily Gmail digest and the existing retry-safe delivery semantics.
- Let buyers subscribe before a matching Listing exists.
- Add a central signed-in page for reviewing and removing subscriptions.
- Avoid Firestore substring indexes, per-subscription documents, and
  per-Listing subscriber scans.
- Keep the feature email-only. Discord remains disabled.

## Non-goals

- Arbitrary user-entered notification keywords.
- Exact ID, rarity, card type, printing, or card-face subscriptions.
- Real-time email, push notifications, Discord notifications, or in-app
  notifications.
- Custom recipient addresses; mail continues to use the verified Google sign-in
  address.
- Official card images, card effects, traits, or other unapproved Card Master
  data.
- Migrating or preserving the existing test-only `characterKeys` documents.

## Fixed Product Decisions

### Subscription identity

A subscription is one complete `cardName` selected from the current Card
Master. The stored value is the selected Card Master string after trimming
leading and trailing whitespace. The system does not apply Unicode, case,
width, punctuation, or internal-whitespace normalization.

Matching uses JavaScript's case-sensitive raw substring behavior:

```ts
listingEvent.cardName.includes(subscribedCardName)
```

Examples:

- `江戶川柯南` matches `江戶川柯南` and `江戶川柯南＆灰原哀`.
- `江戶川柯南` does not match a visually similar string whose code points or
  letter case differ.
- A subscription ignores Listing `cardType`, `cardId`, and `rarity`.
- Overlapping subscriptions may match the same Listing, but that Listing is
  rendered only once in the digest.

### Limits

- A user may keep at most 100 unique subscribed names.
- An accepted name contains 1 to 100 characters after outer trimming.
- The product UI only saves names that exactly equal at least one current Card
  Master `cardName`.
- Duplicate names are rejected rather than silently stored twice.

The Functions boundary validates types, lengths, uniqueness, and limits before
processing a document. Firestore Rules can validate the document shape, list
size, and uniqueness but cannot iterate an arbitrary list to prove every name
exists in Card Master. A malformed or forged entry therefore affects only the
authenticated user's own digest and is skipped safely by Functions.

## User Experience

### Marketplace

Once the Marketplace metadata selector contains a complete name that exactly
exists in Card Master, it shows a single subscription control. Selecting an ID
or rarity is not required. The control applies to that name across all card
types, IDs, and rarities.

Typed text that is not a complete Card Master name never enables the
subscription mutation. Existing marketplace filtering behavior remains
unchanged.

### Listing details

A public active Listing shows the same subscription control when its resolved
`cardName` exactly exists in Card Master. A complete Listing snapshot takes
precedence over legacy Card Master fallback, consistent with the existing
metadata resolver. Ambiguous or unavailable legacy metadata does not expose a
subscription action.

If the Listing name is already covered by a shorter subscribed name, the page
shows `已由「<name>」訂閱涵蓋` and links to subscription management instead of
claiming the exact Listing name is unsubscribed. For example, a subscription to
`江戶川柯南` covers a Listing named `江戶川柯南＆灰原哀`.

### Confirmation and recipient

Starting a new subscription retains an explicit confirmation step:

- notification method: daily email digest;
- recipient: the user's verified Google sign-in email;
- confirmation is required before persistence.

No custom email input is introduced.

### My subscriptions

Add a signed-in `#/notifications` route and a `我的訂閱` navigation entry. The
page lists all subscribed names in deterministic locale order, states that the
delivery method is daily email, and allows each exact subscription to be
removed. It includes loading, empty, read-error, save-error, and saving states.
Unauthenticated visitors receive the existing Google sign-in guidance.

## Data Model

### `notificationSubscriptions/{uid}`

```ts
interface NotificationSubscription {
  uid: string;                 // derived from the document ID in repositories
  cardNames: string[];         // 0..100 complete Card Master names
  emailDailyEnabled: boolean;
  updatedAt: Date;
}
```

Client writes contain only `cardNames`, `emailDailyEnabled`, and `updatedAt`.
`characterKeys` is removed from the current application contract. Documents
that contain only the old shape are ignored by the new reader and may be
overwritten when the test account subscribes again.

An empty `cardNames` list is valid so the user can cancel the last
subscription without requiring a destructive document delete. It produces no
email and remains visible as the empty management state.

### `listingEvents/{listingId}`

The event becomes generic rather than character-only. It contains the existing
delivery sequencing fields plus the approved Listing snapshot:

```ts
interface ListingEvent {
  id: string;
  listingId: string;
  cardType: 'character' | 'event' | 'case' | 'partner';
  cardName: string;
  cardId: string;
  rarity: string;
  listingPrice: number;
  remainingQuantity: number;
  createdAt: Timestamp;
  capturedAt: Timestamp;
  capturedSequence: number;
  discordStatus: 'disabled';
  attempts: 0;
}
```

The event stores no card effect, official image, email address, or subscriber
identity. Its document ID remains the Listing ID, and capture continues to use
transactional create semantics. A retried Firestore trigger observes
`already-exists` and acknowledges the duplicate, preserving idempotency.

## Backend Flow

### Listing capture

`captureListingEvent` validates and captures every active Listing with complete
generic metadata. Character, Partner, Event, and Case use the same event path.
Permanently invalid snapshots are logged and acknowledged; transient Firestore
failures are thrown so the configured Eventarc retry policy can retry them.

New events continue to reserve one monotonically increasing
`capturedSequence`. Discord status is always `disabled`, with no Discord secret,
delivery endpoint, or retry schedule.

### Daily digest window

The scheduled function retains the existing immutable daily run window,
per-recipient cursor, reservation, pre-send transition, recovery operation,
and Gmail retry behavior.

For each subscriber page:

1. Read up to the configured recipient cap of email-enabled subscription
   documents.
2. Strictly validate `cardNames` and resolve each verified Google recipient.
3. Acquire the existing per-user claims and their individual
   `afterSequence` values.
4. Page through generic Listing events from the smallest active
   `afterSequence` through the run's shared `windowEndSequence` once for the
   subscriber page.
5. For each event, consider only claims whose own sequence interval contains
   it, then perform raw substring matching against that subscriber's names.
6. Store matches in a per-user map keyed by `listingId`, which deduplicates
   overlapping names.
7. Complete claims without sending when no events match. Otherwise enter the
   existing pre-send state, send one digest, and complete the cursor.

Listing-event reads are paginated and bounded. The function does not issue one
event query per subscribed name or one complete event query per subscriber.
This keeps Firestore read cost proportional to subscriber pages and new events
in the digest window. CPU substring comparisons are acceptable for the MVP cap
of 100 subscribers per scheduled invocation and 100 names per subscriber.

### Digest content

Matched Listings sort by Listing creation time and Listing ID. The digest
groups by actual Listing `cardName`, not by the subscription term that matched
it. Each row shows card type, visible ID, rarity, price, remaining quantity, and
a link to the Listing. A footer links to `#/notifications`.

No email is sent when none of the user's subscriptions match a new Listing.

## Reliability and Error Handling

- A permanent malformed subscription is skipped without failing other users.
- A missing verified Google email skips that user without exposing or accepting
  an alternate address.
- A malformed Listing event is never included in mail.
- Event pagination failure aborts the scheduled execution before unprocessed
  reservations are marked complete, allowing scheduler retry.
- The existing `reserved` and `sending` states continue to distinguish safe
  automatic retries from ambiguous Gmail sends.
- Listing capture retry remains enabled and safe because the Listing ID is the
  unique event ID.
- UI mutations disable duplicate submissions and retain the last confirmed
  server state when saving fails.

## Security Rules

`notificationSubscriptions/{uid}` remains owner-only for read, create, update,
and delete. The new rule requires exactly these fields:

- `cardNames`: list, at most 100 entries, no duplicates;
- `emailDailyEnabled`: boolean;
- `updatedAt`: timestamp.

The server-only collections `listingEvents`, `notificationDeliveryState`,
`notificationDigestRuns`, and `notificationDigestRuntime` remain denied to all
clients. Card Master remains public-read and client-write-denied.

Rules tests cover owner access, cross-user rejection, old-shape rejection,
unknown fields, excessive or duplicate lists, and protected server
collections.

## Runtime and Deployment

Cloud Functions moves from deprecated Node.js 20 to Firebase-supported Node.js
22 in the same feature. The Functions test and build suites must pass on Node
22-compatible dependencies before deployment.

Deployment order:

1. Firestore Rules and any required indexes.
2. Generic capture and daily digest Functions.
3. Frontend subscription UI and route.

There is no production subscription migration. Existing test-only
`characterKeys` documents remain harmless until overwritten; no production
data deletion is part of this feature. Deployment verification checks the
three expected email-only Functions and performs no production Listing write
or test email send.

## Testing Strategy

### Domain and repository tests

- Accept unique complete `cardNames` and reject malformed, duplicate,
  over-limit, and overlong values.
- Persist and read the new exact Firestore shape.
- Prove old `characterKeys` documents are not treated as valid current
  subscriptions.
- Verify add/remove operations preserve unrelated subscribed names.

### Capture and digest tests

- Capture Character, Partner, Event, and Case Listings.
- Preserve trigger idempotency under duplicate delivery.
- Match the same subscribed name across types, IDs, and rarities.
- Match a complete subscribed name as a substring of a longer Listing name.
- Do not normalize case, width, Unicode form, punctuation, or internal spaces.
- Deduplicate one Listing that matches overlapping subscribed names.
- Read each event window once per subscriber page rather than once per name.
- Send no email when there are no new matches.
- Preserve partial cursor ranges, recipient caps, reservation recovery,
  ambiguous-send handling, and scheduler retry behavior.
- Escape all user-visible values in HTML and text email output.

### Component and route tests

- Marketplace control appears only for an exact current Card Master name.
- ID and rarity are not required to subscribe.
- Listing detail handles exact subscription, substring coverage, unknown
  metadata, sign-in, confirmation, loading, and failure states.
- `#/notifications` lists, sorts, removes, and renders empty/error states.
- Navigation exposes `我的訂閱` only through the intended signed-in workflow.

### Release gate

- Frontend unit/component suite passes.
- Functions unit suite and TypeScript build pass.
- Firestore Rules Emulator suite passes.
- Production frontend build passes.
- Functions manifest exposes only `captureListingEvent`,
  `dailyDigestOperator`, and `sendDailyDigest`.
- Deployment verification confirms Node.js 22 and the three email-only
  Functions without sending a production test email.

## Acceptance Scenarios

1. A buyer selects the complete Card Master name `江戶川柯南`, confirms daily
   email, and sees it in `我的訂閱`.
2. New Character and Partner Listings named `江戶川柯南` both match regardless
   of ID and rarity.
3. A Listing named `江戶川柯南＆灰原哀` also matches because it contains the
   subscribed complete name.
4. A visually similar but code-point-different name does not match because no
   normalization occurs.
5. Multiple matching subscriptions produce one Listing row in one daily email.
6. A day with no matching new Listings advances delivery state without sending
   mail.
7. Removing `江戶川柯南` from `我的訂閱` prevents later Listing events from
   matching that name.
