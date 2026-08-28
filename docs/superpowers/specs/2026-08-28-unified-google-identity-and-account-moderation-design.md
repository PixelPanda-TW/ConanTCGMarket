# Unified Google identity and account moderation design

## Purpose

Make Google the sole account provider for Conan TCG Market.  A visitor may
discover listings without an account, but an authenticated, active account is
required to reveal a seller's contact details, subscribe to a seller, submit a
report, or manage listings.  The same account identity gives an administrator
a fair, auditable way to handle verified misconduct.

Conan TCG Market remains a listing and contact-discovery service.  It does not
provide checkout, payment, escrow, shipping, or transaction arbitration.

## Decisions

- Google sign-in is the only sign-in method in the first release.
- Browsing active listings and their non-sensitive metadata stays public.
- Seller contact details are visible only to signed-in, non-suspended users.
- An admin reviews each report.  A report never changes a user's standing by
  itself.
- Each admin-confirmed violation increments the target account's confirmed
  violation count.  After two confirmed violations, an admin may suspend the
  account.  Suspension is a manual action; it is not automatically triggered.
- A suspended account is disabled in Firebase Authentication and blocked by
  application authorization checks, so an already-issued token cannot retain
  marketplace privileges while it expires.

## Existing-system fit

The repository already uses Firebase Authentication with Google popup sign-in;
Listings and Seller Profiles are keyed by Firebase Auth UID.  This design keeps
that UID as the canonical account key.  It adds no buyer profile, password,
transaction, or copied Google-email document.

The current `sellerProfiles/{uid}` document publicly exposes `contactType` and
`contactValue`.  That must be split before the new access policy is enabled:

- `sellerProfiles/{uid}` becomes the public seller-facing profile (UID and
  display name, plus any deliberately public presentation fields).
- `sellerContacts/{uid}` is server-only and contains `contactType`,
  `contactValue`, `createdAt`, and `updatedAt`.

The client reads a contact through a callable Function such as
`getSellerContact`.  The Function requires a valid authenticated account,
checks that the requester is active, confirms that the target seller has an
active listing/profile, returns only the contact needed for display, and writes
an audit record.  Firestore rules deny all browser access to
`sellerContacts`.  This prevents contacts from being obtained merely by reading
the public profile collection; it does not promise to prevent a legitimate
logged-in user from manually copying a contact they can see.

## Data model

### `accountAccess/{uid}`

Server-owned, private account state:

```ts
interface AccountAccess {
  status: 'active' | 'suspended';
  confirmedViolationCount: number;
  suspendedAt?: Timestamp;
  suspendedBy?: string; // admin UID
  suspensionReason?: string;
  updatedAt: Timestamp;
}
```

It is created lazily by trusted server code on first privileged account use, or
when an administrator first reviews the account.  A missing document is treated
as active with zero confirmed violations, preserving existing user access while
migration is in progress.

### `moderationReports/{reportId}` and `moderationCases/{caseId}`

Both collections are server-owned and unreadable from the browser except
through admin-only Functions/dashboard queries.

- A report records reporter UID, report category, bounded description,
  optional evidence references, target UID when known, and timestamps.
- A case records the admin decision (`open`, `dismissed`, `confirmed`), the
  deciding admin UID, rationale, and the target UID.  Confirming a case and
  incrementing `confirmedViolationCount` occur in one Firestore transaction,
  so retries cannot count the same case twice.

The precise report categories, 100-character limit, and up-to-three image
attachments belong to the subsequent report-ticket feature spec.  That feature
will create reports through a callable Function or HTTPS endpoint, never
directly into the moderation collections.

### `sellerContactAccessLogs/{logId}`

Server-owned append-only audit entries containing requester UID, seller UID,
timestamp, and outcome.  Logs support investigation of abuse.  A per-account
and per-seller rate limit is enforced in the Function; thresholds are an
operational configuration rather than client-controlled data.

## Authorization and flows

### Visitor and active account

1. A visitor can search and view active Listings, images, card data, seller
   display names, and other explicitly public listing metadata.
2. Selecting "查看聯絡方式", subscribing, reporting, selling, or opening a
   private account page prompts Google sign-in when no session exists.
3. After Google sign-in, the application resolves `accountAccess`.  An active
   account can use the requested feature.  A suspended account sees a generic
   suspension notice and is signed out.
4. Contact access invokes the trusted endpoint; the returned contact is held
   in page state and not copied into public Firestore data.

### Seller identity

The same signed-in account can be a buyer, a seller, or both.  There is no role
selection at Google sign-in.  Creating/editing a Seller Profile adds seller
capabilities; all signed-in active accounts retain buyer capabilities.

### Moderation

1. An administrator opens a report and, where applicable, associates it with
   a target account.
2. The administrator dismisses it or confirms a moderation case with a reason.
3. Confirmation atomically records the decision and updates the target's
   violation count.
4. Once the count reaches two, the dashboard presents a suspend action; only
   an administrator deliberately invoking it suspends the account.
5. Suspension updates `accountAccess`, disables the Firebase Auth user through
   the Admin SDK, revokes refresh tokens, writes an audit event, and signs out
   any current browser session on its next authorization check.  Unsuspension
   is an explicit admin action with an audit record; it re-enables Auth and
   changes the status to `active` without deleting the case history.

Admin capability is granted outside the client by a Firebase Auth custom claim
(`admin: true`) managed with the Admin SDK.  The browser must not be able to
self-assign it.  Admin dashboard Functions verify this claim on every request.

## Firestore and Storage policy

- Public reads remain limited to safe Listing/Card/profile presentation data.
- `sellerContacts`, `accountAccess`, moderation collections, contact access
  logs, notification delivery state, and report evidence metadata have no
  direct client Firestore access.
- Seller Profile and Listing writes require `request.auth != null`, ownership,
  and an active account check.  The same active-account requirement is added
  to notification subscriptions and all new privileged writes.
- Report-evidence uploads use a server-authorized, UID-scoped path and strict
  content type/size/count validation.  Admin-only retrieval uses signed URLs
  or an authenticated admin endpoint; evidence is never publicly readable.

Firebase rules cannot call the Admin SDK or disable a user.  Therefore they use
the account-state document to deny current suspended tokens, while Cloud
Functions use the Admin SDK for suspension, revocation, and protected actions.

## Migration

1. Deploy server code and rules that support public profile data plus
   server-only contacts, without yet removing legacy reads.
2. Backfill every existing `sellerProfiles/{uid}` contact field into
   `sellerContacts/{uid}` using a privileged, one-time migration.  Validate
   record counts and spot-check contact values.
3. Deploy the client contact endpoint and replace all public profile-contact
   reads with it.
4. Remove contact fields from public Seller Profiles, tighten Firestore rules,
   and test that unauthenticated reads cannot recover contacts.
5. Enable account-state gating, then release admin moderation tools.

The migration is idempotent and retains an export/backup until validation is
complete.  No existing public contact field is deleted before the new path has
been verified.

## Error handling and user messaging

- Google popup cancellation/failure leaves the visitor on the current page and
  shows a retryable sign-in message.
- A logged-out visitor requesting protected content receives a concise login
  prompt and returns to the original listing after successful sign-in.
- A suspended account sees no case details in the public app; it receives a
  support/contact path decided by the administrator.
- Contact endpoint failures reveal neither whether a seller has a hidden
  contact nor moderation data.  They show a generic retry message and are
  logged server-side.
- Admin actions require a rationale, show the resulting count/status, and are
  written atomically with their audit event whenever possible.

## Test plan

- Auth/component tests: Google sign-in guard for contact, subscription, report,
  and selling actions; intended-page return after sign-in; suspended-session
  handling.
- Rules Emulator tests: anonymous users cannot read contacts; authenticated
  non-admin users cannot read/write account or moderation data; suspended
  users cannot create/update Listings, profiles, or subscriptions.
- Function unit tests: active-account checks, contact authorization and rate
  limit, confirmation idempotency, exactly two confirmed cases without
  automatic suspension, manual suspend/unsuspend behavior, and admin-claim
  enforcement.
- E2E tests: public browsing remains available; contact requires login;
  existing sellers retain contact display after migration; a suspended account
  cannot resume privileged actions; an admin action leaves an auditable case.

## Explicitly deferred

- The detailed bug/violation ticket UI, evidence storage limits, email to
  `conantcgmarket.noreply@gmail.com`, and the admin report queue.
- Seller-specific subscription schema and daily notification delivery.
- Appeals policy, account identity verification beyond Google, automated fraud
  detection, and bans of newly created replacement Google accounts.
- Checkout, payment, shipping, order status, and buyer/seller transaction
  enforcement.
