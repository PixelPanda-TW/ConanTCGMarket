# Batch 4 Secure Contact Disclosure Design

## Purpose

Make seller contact details private by default and reveal them only to a Google-authenticated account whose current account state is active. Public Marketplace visitors may continue to see active Listings and the seller display name. They must not be able to recover LINE IDs, Discord IDs, Facebook profile URLs, or Threads profile URLs through Firestore, initial page data, HTML, or a public endpoint.

This batch preserves the Batch 2 contact meanings: LINE and Discord are canonical identifier strings; Facebook and Threads are canonical personal-profile HTTPS URLs. It uses Batch 3's account-access state as the sole validity check. A missing `accountAccess/{uid}` document is active; a canonical suspended document or any unavailable/malformed state is denied.

## Approved user behavior

- A signed-out visitor sees seller presentation data and a `登入後查看聯絡方式` action.
- Activating that action uses the existing Google popup sign-in and stays on the same Listing route.
- A signed-in active account sees `查看聯絡方式`. Contact data is fetched only after that deliberate action.
- A suspended account or an account whose access state cannot be confirmed cannot reveal contact data.
- The Listing page holds a successful response only in component memory. It is cleared when the Listing ID or signed-in UID changes and is never written to URL, local storage, session storage, analytics, or public Firestore.
- The seller may reveal their own contact through the same endpoint and rules; there is no weaker owner-only public path.
- Invalid or unavailable seller data produces a generic retry/unavailable message without identifying which private record is missing.

## Data model

### Public `sellerProfiles/{uid}`

```ts
interface PublicSellerProfile {
  uid: string;
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
}
```

Only these four logical fields exist; the UID is the document ID, so stored Firestore fields are exactly `displayName`, `createdAt`, and `updatedAt`. Public reads remain allowed because this document contains presentation data only. Browser writes are denied: a trusted callable writes the public profile and private contact together.

### Private `sellerContacts/{uid}`

```ts
interface SellerContact {
  uid: string;
  contactType: 'line' | 'discord' | 'threads' | 'facebook';
  contactValue: string;
  createdAt: Date;
  updatedAt: Date;
}
```

Stored fields are exactly `contactType`, `contactValue`, `createdAt`, and `updatedAt`. Firestore Rules deny every browser read and write. Only trusted server code and the privileged migration may access this collection.

The existing composite `SellerProfile` remains an application-level form/own-profile model so Profile and Sell code can determine seller completeness. It is no longer a public Firestore document shape.

### Server-only contact access controls

- `sellerContactAccessLogs/{logId}` is append-only trusted data with requester UID, seller UID, Listing ID, outcome, and server timestamp.
- `sellerContactRequesterLimits/{bucketId}` stores a requester's count for one UTC hour.
- `sellerContactSellerLimits/{bucketId}` stores a target seller's count for one UTC hour.

All three collections deny every browser read and write. Bucket IDs are deterministic hashes/encodings of the UID plus `YYYYMMDDHH`; raw contact values never appear in logs or limit documents.

## Callable Functions

All callables use Firebase Functions v2 `onCall`, accept only exact allowlisted JSON fields, and translate expected failures to `HttpsError`. They never trust a client UID.

### Shared active-account check

Trusted code resolves the authenticated request UID and reads `accountAccess/{uid}`:

- no authenticated UID: `unauthenticated`;
- missing document: active;
- exact canonical active document: active;
- suspended, malformed, or unreadable document: `permission-denied` or `unavailable`, with no privileged operation performed.

The server validation mirrors Batch 3's exact active shape rather than checking only `status === 'active'`.

### `saveSellerProfile`

Input is exactly `{ displayName, contactType, contactValue }`. The Function:

1. requires an active authenticated account;
2. trims the display name and requires 1–80 characters (the client form adopts the same bound);
3. normalizes and validates the Batch 2 contact semantics server-side;
4. transactionally writes `sellerProfiles/{request.uid}` and `sellerContacts/{request.uid}`;
5. preserves each existing valid `createdAt`, otherwise uses the same server timestamp for creation, and always updates `updatedAt`;
6. returns the canonical composite own profile with timestamps encoded as epoch milliseconds.

The client cannot supply UID or timestamps. A failed write changes neither half.

### `getOwnSellerProfile`

Input is exactly `{}`. The Function requires an active authenticated account and reads both own documents. It returns `null` unless both halves exist and validate. When both are valid it returns the canonical composite profile with epoch-millisecond timestamps. This endpoint supports Profile editing and the Sell-page completeness prerequisite without exposing contact through direct Firestore reads.

A mismatched half-profile is treated as incomplete and logged as an operational error; the UI offers creating/saving the complete profile again.

### `getSellerContact`

Input is exactly `{ listingId }`, where `listingId` is a trimmed bounded identifier. The Function:

1. requires an active authenticated requester;
2. derives the seller UID from `listings/{listingId}` rather than accepting a seller UID;
3. requires the Listing to exist, be `active`, and have positive remaining quantity;
4. requires a valid public seller profile and valid private seller contact for that derived UID;
5. applies the contact-access limits and writes an audit record;
6. returns exactly `{ contactType, contactValue }`.

The endpoint does not return seller UID, profile timestamps, moderation state, email, or any additional account data.

Expected errors are:

- `unauthenticated` for no session;
- `permission-denied` for a non-active requester;
- `invalid-argument` for a malformed payload;
- `not-found` with one generic message when the Listing/profile/contact chain cannot be disclosed;
- `resource-exhausted` when a limit is exceeded;
- `unavailable` for unexpected storage failure.

## Rate limiting and audit

Contact revelation uses fixed UTC one-hour buckets:

- requester cap: 60 accepted reveal requests per UID per hour;
- target-seller cap: 300 accepted reveal requests per seller UID per hour.

Within one Firestore transaction, trusted code reads the active Listing/profile/contact and both current counters, rejects an exhausted bucket, increments both counters, and creates a `revealed` audit entry. A rate-limited request creates a separate `rate_limited` audit entry without incrementing counters. Authenticated requests that cannot resolve a reveal create an `unavailable` audit entry where a seller UID is included only if safely derived. Unauthenticated calls are rejected before Firestore work and are not logged because no stable requester identity exists.

The Listing component caches one successful response, so normal repeated rendering does not call the endpoint again. A user-triggered retry after an error is a new attempt. The limits are abuse controls, not a promise that an authorized recipient cannot copy a revealed contact.

## Client repository boundary

Replace direct own-profile reads/writes with callable wrappers:

- `getSellerProfile(uid)` asserts that `auth.currentUser.uid === uid`, calls `getOwnSellerProfile({})`, validates the wire response, and returns `SellerProfile | null`.
- `saveSellerProfile(profile)` asserts same UID, sends only display/contact input, validates the returned canonical profile, and returns it.
- `getPublicSellerProfile(uid)` directly reads only the strict public converter and returns `PublicSellerProfile | null`.
- `getSellerContact(listingId)` calls the protected endpoint and validates an exact contact-only response.

Callable response validation is fail-closed. Unknown fields, invalid timestamps, invalid contact semantics, or a UID mismatch from own-profile data throw and are not rendered.

## Listing UI state flow

The Listing page loads the Listing, Cards, and public seller profile without contact data. Its contact panel is a state machine:

- auth/account loading: disabled `確認帳號狀態中`;
- signed out: `登入後查看聯絡方式` calls `signIn`; existing Auth errors remain visible through the global auth UI;
- active and unrevealed: `查看聯絡方式`;
- active and loading: disabled `讀取聯絡方式中`;
- active and revealed: render Batch 2 presentation (LINE/Discord as text; Facebook/Threads as safe external links);
- suspended: show account-access guidance and no callable trigger;
- unavailable: show retry-by-refresh guidance and no callable trigger;
- endpoint error: generic inline retry message, except rate-limit copy may state that the hourly limit was reached.

If the authenticated UID, account state, or Listing ID changes, any revealed value and endpoint error are cleared immediately. A stale response from an earlier UID/Listing cannot update the current page.

Seller display-name load failure does not reveal contacts and does not make contact loading automatic. The existing owner management link remains independently gated by active ownership.

## Profile and Sell behavior

- Profile loads the composite own profile through `getOwnSellerProfile` and saves both halves through `saveSellerProfile`.
- The client form retains canonicalization for immediate feedback; the Function independently enforces it.
- Server-returned canonical timestamps become the local saved profile; the client no longer invents authoritative timestamps.
- Sell uses the same composite own-profile endpoint. Only a valid pair of public profile and private contact grants seller completeness.
- Suspended/unavailable behavior from Batch 3 remains unchanged and makes no callable request.

## Firestore Rules

- `sellerProfiles/{uid}`: public read; all browser writes denied.
- `sellerContacts/{uid}`: all browser reads/writes denied.
- contact log and both limit collections: all browser reads/writes denied.
- Existing Listing/Card public reads and account-gated mutations remain unchanged.

The Rules test suite proves that even an active authenticated owner cannot directly read their own `sellerContacts` document or write either profile half. Profile mutations are possible only through the trusted callable.

## Migration and release safety

Add an idempotent Admin SDK migration script. It is dry-run by default and refuses to apply unless all of the following are true:

- `--apply` is supplied;
- an explicit project ID is supplied;
- a generated JSON backup output path is supplied and does not already exist;
- every legacy source profile has an exact supported shape and canonical contact;
- conflicts between an existing private contact and legacy public contact are reported and abort the apply;
- post-write verification confirms matching counts and values before public contact fields are removed.

The apply algorithm first writes/verifies private contacts, then rewrites public documents to their strict public shape in bounded batches, and produces a machine-readable result. Re-running after success is a no-op. Unit tests operate on injected in-memory records only; this batch does not execute the apply mode against production.

Required production rollout order, documented but not performed here:

1. take/export a Firestore backup;
2. deploy Functions that can read split data while legacy public fields still exist;
3. run migration dry-run, review, then separately authorize and run apply;
4. verify every profile/contact pair and confirm anonymous reads cannot access the private collection;
5. deploy tightened Rules;
6. deploy the frontend using callables;
7. retain the backup through the agreed observation period.

Because tightening Rules before migrating would break Profile saves/loads, the setup guide must not reuse Batch 3's generic release wording for this change.

## Test strategy

### Pure Function/domain tests

- strict payload and wire-record validation;
- server-side normalization for all four contact types;
- missing/active/suspended/malformed account decisions;
- exact public/private writes, timestamp preservation, and atomic failure;
- active Listing derivation, sold-out/inactive rejection, generic failures;
- requester/seller limits at boundary values and UTC bucket rollover;
- audit outcomes contain no contact value;
- own-profile incomplete-pair behavior.

### Client repository/component tests

- no direct contact Firestore reads or writes;
- callable wrappers send exact payloads and reject malformed responses;
- Profile uses server-returned data;
- Sell requires a complete callable response;
- Listing auth/account/reveal/error state matrix, deliberate click only, and stale-response isolation;
- no contact is rendered before successful disclosure.

### Rules Emulator

- anonymous and authenticated clients can read strict public profiles;
- no browser identity can write public profiles;
- no browser identity, including the owner, can read/write contacts, logs, or rate documents;
- unrelated Batch 3 authorization remains intact.

### E2E

- public Listing page includes seller display name but no contact value/link;
- contact action prompts Google login and remains on the Listing;
- active account can reveal each text/link presentation correctly;
- suspended account cannot trigger or recover contact;
- seller Profile create/edit round-trips through Functions and still unlocks Sell;
- direct browser Firestore access to contact is denied.

## Out of scope

- Production migration execution, deployment, or any production data mutation.
- Admin contact viewing outside the same active-user flow.
- Reports, moderation screens, evidence, appeals, seller follows, or subscription redesign.
- Preventing an authorized viewer from copying or sharing a contact after reveal.
- Checkout, payment, messaging, escrow, or transaction arbitration.

## Acceptance criteria

1. Public profile documents and anonymous Listing rendering contain no contact fields or values.
2. Every browser read/write to `sellerContacts` and operational contact collections is denied.
3. Profile save atomically writes a strict public profile and strict private contact through an active-account callable.
4. Profile edit and Sell completeness use an active-account callable that returns only the requester's composite profile.
5. Contact can be requested only by Listing ID and only after an explicit action by an active authenticated account.
6. Suspended, malformed, unavailable, and anonymous requesters cannot receive contact data.
7. Inactive, sold-out, missing, or malformed Listing/profile/contact chains disclose nothing and return a generic result.
8. Rate limits and contact-access audit records are server-enforced and expose no contact value.
9. Client responses are strictly validated, stale responses cannot cross UID/Listing state, and revealed data remains memory-only.
10. Existing LINE/Discord text and Facebook/Threads profile-link semantics remain correct.
11. A dry-run-first, conflict-detecting, backed-up migration and safe rollout sequence are documented and tested.
12. No production migration, deployment, or production data mutation occurs in this batch.
