# Character subscription notifications design

## Purpose

Let buyers follow characters they care about. New listings appear immediately in a
public Discord `#新上架通知` channel, while each opted-in buyer receives one
personalized Gmail digest per day for the characters they follow.

This MVP deliberately avoids Discord account linking, Discord direct messages,
per-character Discord channels, and per-listing email. Those choices keep both
cost and operational effort low.

## Scope

Included:

- Character-level subscriptions for authenticated buyers.
- A user-owned daily-email preference.
- A durable new-listing event for every newly created listing.
- One Discord announcement per new-listing event.
- A daily, per-user Gmail digest.
- Firebase rules, Function tests, and Emulator coverage.

Excluded:

- Rarity- or card-ID-specific subscriptions.
- Discord OAuth, Discord private messages, Discord roles, or per-character
  Discord channels.
- Storing a recipient email in Firestore or exposing a Google email publicly.
- Per-listing email alerts, notification analytics, or delivery read receipts.

## Data model

### `notificationSubscriptions/{uid}`

Private, user-owned document:

```ts
interface NotificationSubscription {
  characterKeys: string[];
  emailDailyEnabled: boolean;
  updatedAt: Timestamp;
}
```

`characterKeys` are normalized, stable character tags derived from the existing
listing `characterName` snapshot. A subscription is for the entire character,
regardless of rarity or card ID.

### `notificationDeliveryState/{uid}`

Server-owned document:

```ts
interface NotificationDeliveryState {
  emailDailyCursorSequence?: number;
  emailDailyCompletedRunDate?: string;
  emailDailyClaimId?: string;
  emailDailyClaimState?: 'reserved' | 'sending';
  emailDailyClaimRunDate?: string;
  emailDailyReservedAt?: Timestamp;
  emailDailyWindowEndSequence?: number;
  updatedAt: Timestamp;
}
```

This document is never readable or writable by a browser. It provides the
cursor used to make daily summaries idempotent.

### `notificationDigestRuns/{taipeiDate}`

Server-owned run record keyed by the `YYYY-MM-DD` date in `Asia/Taipei`. Its
event-sequence watermark is created transactionally once and reused by every
duplicate, retry, or overlapping scheduler invocation for that date.

### `listingEvents/{listingId}`

Server-owned, immutable event document:

```ts
interface ListingEvent {
  id: string;
  listingId: string;
  characterKey: string;
  characterName: string;
  rarity: string;
  cardId: string;
  listingPrice: number;
  remainingQuantity: number;
  createdAt: Timestamp;
  discordStatus: 'pending' | 'sent' | 'failed';
  discordSentAt?: Timestamp;
}
```

The document ID equals the Listing ID, so a Firestore trigger can use an atomic
create to deduplicate duplicate delivery of its source event. This event is the
single input for both Discord announcements and email summaries.

## Backend delivery flow

### New Listing to Discord

1. A seller creates an active Listing through the existing authenticated flow.
2. A Firestore-created Function validates that the Listing has a character tag
   and atomically creates `listingEvents/{listingId}` as `pending` if it does
   not already exist. A separate event-delivery worker processes each pending
   event, so an invocation that stops after creation can resume delivery.
3. The worker posts a single message to the configured Discord incoming
   webhook. The message includes character name, rarity, card ID, price,
   remaining quantity, and a direct marketplace link. It never includes seller
   private data or an image payload.
4. The worker records `discordStatus`. Discord failures do not roll back or
   otherwise affect a successfully created Listing. A bounded retry policy
   updates a failed event; operators can inspect failed events without exposing
   them to clients.

Both Firestore-created handlers enable platform retries for transient failures.
The scheduled reconciliation worker processes bounded pages of legacy/new
`pending` events as well as due `failed` events, so a missed create-trigger
delivery does not leave a Listing announcement permanently unscheduled. Invalid
Listing snapshots are rejected at the Function boundary, recorded in structured
logs, and acknowledged as permanent rather than retried forever.

External webhook delivery cannot be made perfectly exactly-once. The durable
event prevents duplicate trigger processing; a failure between a successful
Discord request and saving its status can exceptionally result in a duplicate
message. The design favors an occasional duplicate over silently losing a new
listing announcement.

### Daily Gmail digest

1. A scheduled Function runs at 09:00 Asia/Taipei every day and transactionally
   obtains the date-keyed run's fixed event-sequence watermark.
2. It reads users with `emailDailyEnabled`, then finds Listing events newer than
   each user's private delivery cursor whose `characterKey` is in that user's
   `characterKeys` (chunking character keys to Firestore query limits when
   required).
3. It groups matched events by character and sends exactly one compact email
   with direct listing links. It does not embed card images.
4. A user can complete only once for the date-keyed run. Only after a successful
   send does the worker advance the user's delivery cursor and completed run
   date. A no-event inspection also closes that user's run without sending.
5. A conservative daily recipient cap protects the dedicated Gmail sender's
   free quota. Deferred users retain their old cursor and receive their
   accumulated digest later rather than losing notifications.

The Function obtains the recipient at send time from the signed-in Firebase
Authentication user's verified Google email. No email address is copied to
Firestore, Seller Profiles, or a public response.

Pre-send `reserved` claims use a 15-minute stale threshold, longer than the
explicit 540-second Function timeout, and may be atomically reclaimed. Once the
worker durably enters `sending`, Gmail acceptance is externally ambiguous: the
claim never expires automatically. A private-IAM operator endpoint lists active
claims and requires the exact UID, claim ID, and either `definitely-unsent`
(reserved only) or `sent-or-ambiguous` (sending only). The latter advances the
cursor without retrying. This boundary intentionally provides at-most-once Gmail
delivery and may omit one digest rather than risk sending a duplicate.

## Cost and operations

- A single Discord channel and incoming webhook provide the public real-time
  feed, with no Bot account or Discord account linking.
- Gmail API sends mail from a dedicated marketplace Gmail account. OAuth client
  credentials and refresh token are Firebase Secrets, never repository files.
- Discord webhook URL is also a Firebase Secret.
- Cloud Functions require the Firebase Blaze plan for production deployment.
  Before deployment, configure a small budget, budget alerts, and a Cloud Run
  Functions spend cap. The MVP's listing-trigger work stays constant per
  Listing; it does not fan out to all subscribers at listing time.
- Daily aggregation shifts the only per-subscriber work to one scheduled batch,
  making popular character listings inexpensive and fast to publish.

## Client experience

- When the existing character selector contains a valid character, Marketplace
  and Listing detail show a single subscribe/unsubscribe control.
- Clicking it while signed out follows the existing authentication guidance.
- Authenticated buyers manage all subscriptions and the email digest toggle at
  `#/notifications`, exposed as “通知設定” in authenticated navigation.
- The setting page states that Discord is a public, all-listings live feed and
  does not require a Discord account connection.
- Email contains a link to `#/notifications` so a recipient can disable the
  digest after signing in.

## Security rules

- `notificationSubscriptions/{uid}`: authenticated owner may read, create,
  update, and delete only their own document.
- `notificationDeliveryState/{uid}` and `listingEvents/{id}`: no direct client
  reads or writes. Firebase Admin SDK Functions bypass rules to manage them.
- `notificationDigestRuns/{date}` and notification runtime state: no direct
  client reads or writes.
- Existing Listing, Seller Profile, and Sales rules remain unchanged except for
  tests demonstrating that notification data is private.
- Firebase Secrets are configured only in deployment environments and are never
  passed to the Vite client bundle.

## Test plan

- Domain tests: normalization and validation of character subscription keys.
- Repository/component tests: subscribe, unsubscribe, email toggle, signed-out
  guidance, and notification settings routing.
- Function unit tests with mocked Discord and Gmail clients: event creation,
  Discord payload, failure isolation, cursor behavior, grouping, deferred quota
  behavior, and no duplicate completed digest.
- Firestore Emulator rules tests: owners can manage only their subscription;
  clients cannot read or write events or delivery state.
- Regression verification: full frontend suite, Functions suite, rules suite,
  and production builds for both web and Functions.

## Deployment prerequisites

1. Upgrade Firebase project to Blaze and add budget alerts/spend cap.
2. Create Discord `#新上架通知` incoming webhook and set its URL as a Firebase
   Secret.
3. Create a dedicated Gmail sender, enable Gmail API, complete one-time OAuth
   authorization, and set OAuth values as Firebase Secrets.
4. Deploy Functions, Firestore rules, and web application.
5. Test with a non-production Listing and a test subscriber before enabling the
   public notification channel.
