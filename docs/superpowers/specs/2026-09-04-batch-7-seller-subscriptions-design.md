# Batch 7 Seller Subscriptions and Daily Digest Design

## Purpose

Let an authenticated, active buyer subscribe to a seller from an active Listing
and receive that seller's future Listings in the existing daily email digest.
The same Firebase UID may remain both buyer and seller. This batch reuses the
existing `#/notifications` page, Listing-event pipeline, verified Google email
lookup, and at-most-once daily delivery protocol.

This is a repository implementation batch only. It does not deploy Functions,
Rules, or frontend assets; mutate a production subscription; send a live email;
or alter production Listing events.

## Approved product behavior

- Seller subscriptions are an active product priority.
- Delivery is daily aggregation only. There is no immediate email, push,
  webhook, or Discord delivery for a seller follow.
- Any active Google-authenticated account is a valid buyer and can subscribe;
  no Seller Profile is required.
- A seller is followed by immutable Firebase seller UID, not display name.
- The UI shows the seller's current public display name when available.
- A person does not receive a follow control for their own seller UID.
- Suspended or unresolved accounts cannot add or remove seller subscriptions.
  Suspended users remain signed in and can see their account-state notice.
- The entry point is an active Listing detail page. Card Master remains
  unrelated to seller identity.
- `#/notifications` remains the single management page for card-name and seller
  subscriptions plus the shared daily-email preference.

## Existing-system facts

The current system stores one `notificationSubscriptions/{uid}` document with
`cardNames`, `emailDailyEnabled`, and `updatedAt`. Client mutations already use
a Firestore transaction, which prevents two open controls from blindly
overwriting each other. Rules restrict the document to its owner and active
account state.

The daily digest pages email-enabled subscription documents, claims one durable
delivery window per recipient, scans captured Listing events once per page,
deduplicates by Listing ID, and crosses a durable `beginSend` boundary before
Gmail. Those reliability properties must remain unchanged.

Current Listing events do not retain `sellerId`, so seller matching cannot be
implemented from existing events without extending the event snapshot. The
new field must not be inferred from mutable Seller Profiles or Card Master.

## Data model

### Browser subscription model

Extend the existing document with a canonical `sellerSubscriptions` array:

```ts
interface SellerSubscription {
  sellerId: string;
  followedAt: Timestamp;
}

notificationSubscriptions/{buyerUid} = {
  cardNames: string[];
  sellerSubscriptions: SellerSubscription[];
  emailDailyEnabled: boolean;
  updatedAt: Timestamp;
}
```

The browser-domain model represents both timestamps as `Date`. A canonical
seller entry has exactly `sellerId` and `followedAt`. Seller IDs are trimmed,
1–128 characters, unique within the document, and sorted by `sellerId` when
persisted. At most 100 seller entries and at most 100 card names are allowed.
The two limits are independent.

The follow timestamp is required because a new follow must not replay all old
Listings from an account's first delivery cursor. Seller matching includes an
event only when its capture time is at or after that seller entry's
`followedAt`. Removing and later re-following a seller creates a new timestamp
and does not replay the removed interval.

Existing documents without `sellerSubscriptions` remain readable as legacy
card-name-only subscriptions and normalize to an empty array. Every successful
client write upgrades the document to the exact new shape. Unknown or partial
fields still fail closed.

### Listing-event model

Every newly captured Listing event adds the Listing's immutable `sellerId`:

```ts
listingEvents/{listingId} = {
  // existing canonical Listing-event fields
  sellerId: string;
}
```

New event capture requires a canonical seller UID from the created Listing.
Existing stored events without `sellerId` remain valid for card-name matching
but can never match a seller subscription. An event with a malformed seller ID
is rejected rather than guessed. No historical event backfill is part of this
batch.

## Persistence and concurrency

Add targeted repository operations:

- `addNotificationSeller(uid, sellerId, followedAt = new Date())`
- `removeNotificationSeller(uid, sellerId)`

They use the existing owner assertion and Firestore transaction. Each operation
reads the latest document, preserves card names and the email preference,
changes only the requested seller entry, validates the complete next model,
and writes one canonical document. Adding an already-followed seller is
idempotent and retains the original `followedAt`; removing a missing seller is
an idempotent no-op.

Adding a seller through the confirmation UI enables the shared daily email
preference, matching the existing card-name subscription behavior. Removing
the last seller does not remove card-name subscriptions or delete the document.
Changing the global daily-email checkbox affects both subscription kinds.

The client timestamp is not an authorization boundary: the user can affect only
which public Listing notices reach their own verified email. Function parsing
still bounds and validates all persisted values. Server-owned delivery state,
recipient lookup, Listing events, and Gmail remain inaccessible to browsers.

## Daily matching

For each valid email-enabled subscription, the digest accepts a recipient when
at least one valid card name or seller entry exists. For each event within that
recipient's claimed sequence window, include it when either:

1. `event.cardName` contains a subscribed card name under the existing raw,
   case-sensitive substring rule; or
2. `event.sellerId` equals a subscribed seller UID and
   `event.capturedAt >= followedAt`.

One event matching both conditions appears once because the existing
`Map<listingId, event>` deduplication remains authoritative. Sorting, grouping,
email subject, HTML/text escaping, no-match completion, recipient cap,
pagination, reservation lease, `beginSend`, recovery decisions, and
at-most-once behavior remain unchanged.

A malformed seller entry makes that subscription document ineligible for the
run; it must not weaken validation or affect other recipients. Legacy events
without seller IDs remain eligible only through card-name matching.

## UI behavior

### Listing detail

For a non-owner active Listing, render a seller-subscription control near the
seller identity:

- signed out: `訂閱賣家 <displayName>` opens concise Google sign-in guidance;
- active and loading: render a stable loading state;
- active and not followed: open an explicit daily-email confirmation;
- active and followed: render `取消訂閱賣家 <displayName>`;
- suspended/unavailable: show account-state guidance and no mutation control;
- owner: render no follow control;
- sold out: render no follow control;
- load/save failure: retain the current page and show retryable generic text.

The confirmation states that notifications go to the verified Google login
email as one daily digest. Confirm is disabled until the user checks the email
consent box. Pending operations are single-flight, controls are disabled, and
stale async results from another Listing/account scope are ignored. Focus
returns to the action after a successful mutation or cancellation.

### Notification settings

Keep the existing `我的訂閱` route and add an `已訂閱賣家` section alongside
`已訂閱卡名`. Load current public profiles for followed seller IDs after the
subscription document resolves. Sort resolved names with `zh-Hant` collation,
then seller UID as a deterministic tie-breaker.

If a Seller Profile is missing or unreadable, show `無法取得賣家名稱` and retain
an accessible remove control; never discard the subscription silently. Profile
load failure for one seller does not hide other entries. Removing a seller uses
the same pending/error guards as card-name removal. The daily-email explanation
must state that it covers both subscribed card names and sellers.

## Rules and trust boundaries

- `notificationSubscriptions/{uid}` remains readable/writable only by its
  active owner, with the legacy and new exact schemas explicitly recognized.
- New-shape writes require `sellerSubscriptions` to be a list of at most 100
  entries. The application and digest perform the strict per-entry validation;
  malformed data affects only that owner's notification eligibility.
- `listingEvents`, delivery state, digest runs, batch cursors, and Gmail remain
  server-only.
- Public `sellerProfiles` supply display names only. Contact data is never read,
  stored in a subscription, or placed in an email.
- The follow UI and repository cannot grant seller, admin, or moderation
  capability.

## Compatibility and release safety

No migration is required. Legacy subscription and Listing-event documents are
read-compatible. New frontend writes only after Functions understand both
subscription shapes and new/legacy event shapes.

If later released with separate approval, order is:

1. Functions accepting legacy and new subscription/event documents;
2. Firestore Rules accepting the bounded new owner-write shape;
3. frontend seller-follow UI.

Production verification is non-invasive: inspect deployed manifests, Rules,
document-shape aggregates, and digest metrics. Do not create a real follow,
Listing, or email as a smoke test. Interactive coverage runs only in the fixed
demo Emulator.

Rollback removes the frontend entry first. Keep compatibility-capable Functions
and Rules so already-upgraded documents remain readable. Do not delete
`sellerSubscriptions` fields or Listing-event seller IDs. Roll forward from
logs and Emulator reproduction.

## Testing strategy

- Domain/converter tests: exact seller entry validation, limits, uniqueness,
  deterministic ordering, legacy reads, and canonical writes.
- Repository tests: owner assertion, transactional add/remove, idempotency,
  preservation of card-name/email fields, and failure behavior.
- Listing-event tests: new seller ID capture, legacy event reads, malformed
  rejection, and exact stored adapter fields.
- Digest tests: seller-only recipient, followedAt floor, OR matching,
  dual-match deduplication, legacy card-only behavior, malformed seller entries,
  no-match, pagination, and delivery reliability regression.
- Component tests: guest/active/suspended/owner/sold-out states, consent,
  pending/error/success, stale scope suppression, settings names/missing profile,
  removal, and global preference copy.
- Rules Emulator tests: new owner shape allowed within bounds; anonymous,
  cross-user, suspended, malformed, extra-field, and oversized writes denied;
  operational collections remain private.
- Chromium E2E: sign in from Listing, follow seller with daily consent, verify
  exact Firestore shape, manage/remove in settings, prove suspended denial, and
  invoke the fake daily digest to prove one seller match, one dual-match row,
  and no historical replay.

## Out of scope

- Immediate seller alerts, push notifications, Discord follows, or delivery
  frequency selection.
- A public seller storefront/profile route.
- Following from search cards or Dashboard.
- Report tickets, evidence uploads, moderation cases, suspension, restoration,
  republishing, or appeals.
- Production migration, deployment, subscription mutation, Listing creation,
  or live email.

## Acceptance criteria

1. Active Google users can follow and unfollow another seller from an active
   Listing without completing a Seller Profile.
2. Owners, suspended users, sold-out pages, and unresolved account states cannot
   invoke a seller-follow mutation.
3. Seller subscriptions use seller UID plus an immutable follow timestamp and
   never store seller contact data.
4. Existing card-name-only documents and seller-ID-less Listing events remain
   readable without migration.
5. New Listing events contain the canonical Listing seller UID.
6. Daily digest matching is card-name OR followed-seller, applies the follow
   time floor, and deduplicates dual matches by Listing ID.
7. A seller-only subscription can receive a daily digest; no match sends no
   email and still advances the delivery state safely.
8. `#/notifications` displays and removes followed sellers while preserving
   card-name subscriptions and the shared email preference.
9. Direct browser access remains limited to the active owner's bounded
   subscription document; operational notification data stays server-only.
10. Emulator E2E proves the UI → transaction → event → digest path without a
    production follow, Listing, email, deploy, or data mutation.
