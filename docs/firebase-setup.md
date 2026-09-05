# Firebase Setup

## Local Development

Create `.env` from `.env.example` and fill it with the Firebase web app config from Firebase Console.

Required variables:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

## Firebase Console

Enable Authentication with Google as a sign-in provider.

Add these authorized domains for Authentication:

- `localhost`
- `127.0.0.1`
- `PixelPanda-TW.github.io`

## GitHub Pages Deployment

Add the same values as repository variables before deploying with GitHub Actions. The workflow reads these repository variables as `VITE_FIREBASE_*` values during the Vite build.

GitHub Pages deployment is web-only. It builds and publishes the Vite site; it
does not deploy Firestore rules, indexes, or Cloud Functions.

## Controlled Card Master synchronization and import

The authoritative synchronization, report-gate, dry-run, credentials, batching,
composite-key migration, and no-delete instructions live in the
[Card Master import guide](card-master-import.md). Use that guide as the single
operator procedure; do not copy an older artifact path or a workflow that uses
the visible ID as the document ID from historical notes.

Firebase setup does not authorize a production import. The production command
in the canonical guide remains explicitly prohibited until the user reviews and
approves the exact generated artifact, its successful fail-closed sync report,
the dry-run result, and that exact command. No Card Master production mutation
is implied by configuring Firebase, ADC, or `GOOGLE_CLOUD_PROJECT`.

## Card Master admin operations and release

Card Master is an internal database, not an end-user product: there is **no
standalone public Card Master page**. Active records in `cards` support
Marketplace search and Listing validation. The private `#/admin/cards` route is
the only management UI, and it appears only when the signed-in account is active
and its Firebase custom claim satisfies exact boolean `admin === true`.

All mutations remain server-owned. `listCardMasterArchives`,
`addCardMasterEntry`, `editCardMasterEntry`, `mergeCardMasterEntries`, and
`disableCardMasterEntry` are authenticated callable Functions. Firestore Rules
permit public reads but deny every browser write to `cards`. The server-only
collection `cardMasterArchives` records disabled, superseded, and merged
identities; the server-only collection `cardMasterAuditLogs` records every
admin action. Browsers cannot read or write either collection, even with an
admin claim. Historical Listing and Sale snapshots are never rewritten by a
Card Master operation.

### Custom-claim gate

Claim inspection and claim assignment are privileged production operations.
Both are **prohibited until separate explicit approval** of the exact command,
target project, operator identity, and intended Firebase UID. Never substitute
an email address for a UID, never place a real UID in this repository, and never
run these examples merely to verify a deployment.

The following read-only claim inspection command is an operator template only:

```sh
ADMIN_UID='<firebase-uid>' GOOGLE_CLOUD_PROJECT='conantcgmarket' node --input-type=module --eval "const {initializeApp}=await import('firebase-admin/app'); const {getAuth}=await import('firebase-admin/auth'); initializeApp(); const user=await getAuth().getUser(process.env.ADMIN_UID); console.log({uid:user.uid,admin:user.customClaims?.admin===true});"
```

The following claim assignment command is a mutation and needs its own explicit
approval after inspection confirms the exact UID:

```sh
ADMIN_UID='<firebase-uid>' GOOGLE_CLOUD_PROJECT='conantcgmarket' node --input-type=module --eval "const {initializeApp}=await import('firebase-admin/app'); const {getAuth}=await import('firebase-admin/auth'); initializeApp(); const auth=getAuth(); const user=await auth.getUser(process.env.ADMIN_UID); await auth.setCustomUserClaims(user.uid,{...(user.customClaims??{}),admin:true});"
```

Changing or removing that claim is also a separate production mutation. A
claim change does not prove current account access: the callable repeats the
canonical `accountAccess` check and rejects suspended or malformed accounts.

### Release order, verification, monitoring, and rollback

Approval of repository code or this guide does not authorize a production
claim, deploy, import, callable invocation, or Card mutation. After the complete
local quality, Rules, and Chromium gates pass, the Card Master release order is
**Functions → Rules → frontend**. Each production stage requires separate
operator approval. Deploy Functions first so every frontend operation has a
trusted handler, Rules second to install the explicit server-only collection
boundaries, and the frontend last.

Interactive mutation smoke testing is allowed only against the fixed local demo Emulator,
`demo-conan-tcg-e2e`. Production verification is non-invasive:
inspect the deployed Function manifest, Rules release, frontend asset version,
custom-claim state after separately approved claim inspection, and aggregate
Cloud Logging metrics. It **must not add, edit, merge, or disable a production Card**.

Monitor callable success totals and `permission-denied`, `aborted`,
`failed-precondition`, `already-exists`, and `unavailable` rates. Compare active
`cards`, archive, and audit counts without reading or exporting user data. A
rise in stale conflicts or authorization failures pauses the rollout.

For rollback, stop at the first failed stage. Keep the tightened Rules and the
append-only `cardMasterArchives` / `cardMasterAuditLogs` evidence; do not restore
a retired Card or rewrite Listing/Sale history. Roll back the frontend first,
then the Functions release if needed. Investigate and repair forward from audit
records. Removing an admin claim, restoring a Card, or changing production data
requires a new explicit approval.

## Secure seller contact split

Seller presentation and contact data have different trust boundaries:

- `sellerProfiles` contains only public display name and timestamps;
- `sellerContacts` contains the private LINE/Discord identifier or
  Facebook/Threads personal-profile URL;
- `sellerContactAccessLogs` is the append-only disclosure audit;
- `sellerContactRequesterLimits` and `sellerContactSellerLimits` are trusted
  UTC-hour counters.

Firestore Rules deny every browser read/write to the latter four operational
collections and every browser write to `sellerProfiles`. The callable Functions
`saveSellerProfile`, `getOwnSellerProfile`, and `getSellerContact` verify the
authenticated account and current `accountAccess` state on the server. Contact
reveal is limited to 60 reveals per requester per UTC hour and
300 reveals per seller per UTC hour. Contact values are never written to audit
or counter data.

### Migration safety and exact release order

Approval of this guide does not authorize migration `--apply`, deployment, or
any production data mutation. A production operation needs a separate,
explicit operator approval for the reviewed dry-run result, exact backup path,
and exact command. Use a maintenance window that prevents profile edits for the
entire migration/verification interval; the migration deliberately aborts on
malformed data or a private/legacy contact conflict rather than choosing a
winner.

First take a managed Firestore export and record its location. Then deploy only
the three split-aware callable Functions while the existing legacy fields and
Rules remain available. Run the read-only dry-run:

```sh
npm run migrate:seller-contacts -- --project conantcgmarket
```

Review source, legacy, contact-write, and public-rewrite counts. Resolve every
validation/conflict result before continuing. Prepare a local backup directory
outside the web build; the JSON path must not already exist. Only after separate
approval, run exactly:

```sh
npm run migrate:seller-contacts -- --project conantcgmarket --backup ./backups/seller-contacts-YYYYMMDD.json --apply
```

Apply mode writes the non-overwritable JSON backup before mutation, writes
private contacts in batches of at most 400, reads them back in bounded batches,
and removes public contact fields only after count/value/timestamp verification.
Retain both the managed export and JSON backup through the observation period.
If verification fails, stop: public cleanup is not started. Preserve the backup,
inspect conflicts, and rerun only after a new dry-run and approval.

The complete contact release sequence is **Functions → migration → Rules → frontend**.
After apply succeeds, independently verify that every `sellerProfiles` document
has exactly `displayName`, `createdAt`, and `updatedAt`, and that each has one
matching `sellerContacts` document. Then deploy Firestore Rules, followed by the
web frontend. Do not use the notification section's no-migration procedure for
this one-time schema cutover.

Rollback favors privacy and roll-forward repair: do not restore contact fields
to public profiles merely to run the old frontend. Keep the tightened Rules,
restore private records from the reviewed backup/managed export if necessary,
and redeploy the last known split-aware Functions/frontend.

### Contact release verification and monitoring

Local release gates include Function unit tests, Rules Emulator tests, and the
Chromium contact-disclosure journey. Production verification is non-invasive:
inspect the deployed Functions manifest, Rules release, aggregate migration
counts, and Cloud Logging. It creates no Listing/Profile/contact, sends no
notification, and must not reveal a real seller contact. Do not invoke
`getSellerContact` against a real Listing merely as a deployment probe.

Monitor `sellerContactAccessLogs` outcome counts and the number of exhausted
documents in both limit collections. Investigate unusual requester/seller
concentration without exporting contact values. A threshold change is a code
and review change; never edit counters to silently bypass a limit.

## Trusted Listing lifecycle and Sale history rollout

The browser may create a new canonical Listing, but it cannot update or delete
an existing Listing and cannot write a Sale. Those mutations are owned by three
authenticated callable Functions:

- `recordListingSale` validates the active owner and immutable card snapshot,
  then creates the Sale and decrements inventory in one transaction;
- `updateSellerListing` changes only photos, price, service options, fees, and
  note, using `updatedAt` as an optimistic-concurrency version;
- `deleteUnsoldListing` deletes only an active Listing whose inventory is
  untouched and which has no Sale, then returns the canonical image URLs for
  client-side Storage cleanup.

Sold-out Listings stay readable to their owner and remain in the Dashboard,
while public Marketplace queries expose only active Listings. Sales are
immutable after creation. Legacy Sales remain readable, but only the exact
recognized seven-field legacy shape is accepted; no display ID or Card Master
record is used to guess historical data.

### Sale snapshot audit and migration gate

Approval of designs, code, or this guide does not authorize Sale migration `--apply`,
deployment, production writes, a real Sale, or deletion. Each
production operation requires separate explicit operator approval for the exact
command and reviewed evidence. First take a managed Firestore export, deploy
only the three lifecycle Functions, and run the read-only audit:

```sh
npm run migrate:sale-snapshots -- --project conantcgmarket
```

Review `sourceCount`, `normalizedCount`, `legacyCount`,
`backfillWriteCount`, every unresolved Sale, and every validation conflict.
The audit backfills only from the Sale's referenced Listing when that Listing
already contains a canonical `cardType`, `cardName`, and `rarity` snapshot.
Missing or legacy-only Listing metadata remains unresolved. Resolve all such
records without guessing, rerun the dry-run, and retain its exact output.

Only after a separate approval, choose a new local backup path outside the web
build and run exactly:

```sh
npm run migrate:sale-snapshots -- --project conantcgmarket --backup ./backups/sale-snapshots-YYYYMMDD.json --apply
```

Apply mode refuses a pre-existing backup path or any unresolved Sale, writes a
complete JSON backup before mutation, updates only the three missing snapshot
fields in batches of at most 400, and reads every changed Sale back before
reporting success. It never deletes a document or fetches card images/effect
text.

The lifecycle release sequence is **Functions → separately approved Sale audit/backfill → Rules → frontend**.
Do not deploy Rules or the frontend merely because the dry-run completed. After
the separately approved backfill verifies, deploy the Rules that deny browser
lifecycle writes, then release the callable-backed frontend.

For rollback, stop after the first failed stage and preserve the managed export,
JSON backup, dry-run output, and logs. Prefer roll-forward repair after Rules are
tightened; do not re-enable browser Sale or existing-Listing writes. If a
Function release fails before Rules change, restore the previous Functions and
repeat the full dry-run before requesting new approval.

Production verification is non-invasive: inspect the deployed Function
manifest, Rules release, migration counts, callable error rates, and inventory
versus Sale aggregates. It creates no production Listing or Sale, deletes no
object, and invokes no lifecycle callable against real user data. Continue to
monitor `failed-precondition`, `aborted`, and `unavailable` rates after release;
unexpected inventory or snapshot conflicts stop the rollout and trigger the
rollback procedure above.

## Private moderation report lifecycle and release

An active Google-authenticated buyer may report another seller's active Listing;
a Seller Profile is not required. Owners, suspended or malformed account states,
and inactive Listings are rejected by the callable boundary. The form accepts one
approved category, a trimmed 1–100-character plain-text description, and **0–3 evidence images**.
Evidence is limited to JPEG, PNG, or WebP and **5 MiB per image**. Draft creation
is capped at **10 reports per reporter per UTC day** and uses a **24-hour draft expiry**.

`createModerationReportDraft` and `submitModerationReport` are authenticated
callables. The first operation derives a private request key and creates the safe
Listing snapshot; the second verifies the actual Storage metadata before changing
the draft to `submitted`. Both retry boundaries are idempotent: repeating a
compatible request returns the same draft or ticket, while a conflicting retry
fails closed. The daily `cleanupExpiredReportDrafts` schedule runs at 03:30
Asia/Taipei in bounded pages, deletes only expired draft slots and request-key
pointers, and never deletes submitted reports or their evidence.

The Firestore collections `moderationReports`,
`moderationReportRequestKeys`, and `moderationReportLimits` are **server-only**:
browsers cannot read or write them. Draft evidence uses exactly
`reportEvidence/{reporterId}/{reportId}/{slot}`, where the slot is 0, 1, or 2.
Storage Rules permit only the active draft owner to create, replace, or remove a
valid slot before expiry; all browser reads and all post-submission writes are
denied. Reports contain a safe Listing snapshot and never copy seller contact,
reporter email, Google identity presentation, arbitrary client fields, signed
URLs, or image bytes. Submission sends **no reporter email**, seller message,
admin email, push message, or Discord notification.

This additive workflow requires **no migration** of existing Firestore documents
or Storage objects. A separately authorized production release must use
**Functions → Rules → frontend**: trusted handlers first, private Firestore and
Storage boundaries second, then the report route and entry point. Approval of
repository code or this guide does not authorize any stage. Production
verification is non-invasive and **must not create a production report**, **must not upload production evidence**,
invoke cleanup, send email, or mutate user data.
Inspect only the deployed Function manifest and schedule, Rules release, frontend
asset version, aggregate callable outcomes, cleanup outcome counts, and sanitized
Cloud Logging error codes.

After an authorized release, monitor callable error and latency rates, daily draft
counter rejections, expired-draft backlog, cleanup failures, Storage denial rates,
and unexpected report-volume changes. Never inspect descriptions or evidence as a
health probe. Stop the rollout on unexplained authorization, metadata, or cleanup
errors. For rollback, remove or disable the frontend entry point first, retain the
tightened Rules, and roll back Functions only after confirming the retained Rules
remain compatible. Preserve submitted reports and evidence; deletion, manual
cleanup, data restoration, or a Rules relaxation requires separate explicit
approval.

## Private admin moderation review and release

The admin review surface is private and callable-only. Access requires an
authenticated **active account** and an **exact `admin === true` custom claim**;
truthy strings, stale claims paired with suspended access, malformed access
records, non-admin users, and signed-out users fail closed. The browser routes
`#/admin/moderation` and `#/admin/moderation/:reportId` provide the
private queue, case detail, and generation-pinned evidence. `moderationCases` and
`moderationReports` remain unreadable and unwritable through the browser SDK,
including for admins, and evidence remains unreadable through the Storage SDK.

The trusted surface consists of `listModerationCases`, `getModerationCase`,
`getModerationEvidence`, and `decideModerationCase`. Queue reads are filtered,
bounded, and deterministically paginated. Detail reads return only the approved
report, decision, safe Listing snapshot, evidence summaries, and target-account
summary. Evidence is fetched one object at a time only after explicit admin
action; the Function verifies the report's recorded generation, content type,
and size before returning bytes. The browser uses a short-lived Blob URL and
revokes it when replaced, closed, or unmounted. No signed URL or Storage path is
returned.

Dismissal and confirmation require a trimmed 1–1,000-character rationale.
Terminal **decisions are immutable and idempotent**: an exact retry returns the
stored result, while a conflicting or concurrent decision fails closed. For
confirmation, **confirmed decisions atomically increment** the target account's
`confirmedViolationCount` in the same transaction that closes the case, exactly
once. A count of two or more is only suspension eligibility. This batch
does not automatically suspend an account, disable Auth, revoke tokens, hide
Listings, or expose suspension controls. Dismissal never writes account access.
The workflow sends **no moderator email**, reporter or seller notification,
Discord message, or push notification, and requires **no migration** because the
report workflow is not production-live.

### Admin moderation release, verification, monitoring, and rollback

Repository readiness does not authorize release. After separate operator
approval, use the fixed order **Functions → indexes → Rules → frontend**. Deploy
the callable and atomic case-creation support first, wait for the
`moderationCases` composite index in `firestore.indexes.json` to become ready, then
deploy the private Rules, and only then publish the admin routes. These are
separate production actions; approval of one does not imply approval of the
next.

Non-invasive verification may inspect only the deployed Functions manifest,
index readiness, Rules release, frontend asset version, and aggregate sanitized
metrics. It must not send email or mutate production data merely as a probe:

- It **must not read a production report**.
- It **must not download production evidence**.
- It **must not decide a production case**.
- It **must not change a production violation count**.

Do not log descriptions, rationales, reporter IDs, evidence bytes, or account
details.

After an authorized release, monitor bounded queue/detail/evidence/decision
error and latency rates, confirmation and dismissal counts, transaction
conflicts, malformed report/case-pair failures, evidence metadata mismatches,
response sizes, and permission denials. Stop the rollout on unexplained access,
pair-integrity, or count errors. For rollback, remove the frontend routes first
while retaining the private Rules. Preserve all reports, cases, evidence, and
confirmed counts. Roll back Functions only to a version that still creates a
case with every newly submitted report; never delete a case or decrement a
count as rollback. Any production release, rollback, repair, evidence access,
or data mutation requires separate explicit approval.

## Notification Functions deployment

Production Cloud Functions require the Firebase Blaze plan. Before setting any
secrets or deploying, upgrade the Firebase project to Blaze, configure a small
budget alert, and set a Cloud Run Functions spend cap appropriate for this MVP.
Review those limits regularly; budget alerts notify after usage accrues and are
not a hard spending limit.

The daily digest schedule runs at 09:00 `Asia/Taipei`.

Discord delivery is currently disabled. New Listing events are stored with
`discordStatus: disabled`, no Discord retry timestamp is created, and the
Discord delivery and retry Functions are not exported for deployment. If
Discord is enabled in a future release, only Listings created after that
release should be announced; do not replay disabled historical events.

The Functions package runs on the Node.js 22 runtime.

Each subscriber stores complete Card Master card names in `cardNames`. The
digest applies raw substring matching, including case-sensitive comparison,
across all card types, IDs, and rarities. No-match delivery rule:
no matching new Listings means no email is sent for the subscriber's pending
digest window.

### Seller-follow compatibility and privacy

Seller follows use the same **daily digest only**. There is **no immediate seller notification**.
An active Google-authenticated buyer may follow another seller from an active
Listing, whether or not the buyer also has a Seller Profile. A Listing owner
cannot follow their own seller identity, and suspended or unresolved accounts
cannot add or remove follows.

**Seller UID is identity; display name is presentation.** The owner-scoped
`notificationSubscriptions/{buyerUid}` document stores at most 100 canonical
`sellerSubscriptions` entries with only `sellerId` and `followedAt`. New Listing
events capture `sellerId` from the trusted Listing snapshot. The digest compares
UIDs, never display text. A matching event must have `capturedAt >= followedAt`,
so **pre-follow Listings never replay**. A Listing matched by both `cardNames`
and a followed seller is included once by Listing ID.

Compatibility is additive and requires **no migration**. Existing legacy card-name-only documents
without `sellerSubscriptions` read as an empty seller-follow list and
continue matching cards. Legacy Listing events without `sellerId` continue
matching card-name subscriptions but cannot match a seller follow. A subsequent
write from the current frontend upgrades the owner's subscription document to
the new four-field shape; historical events and documents are not rewritten.

Contact data never enters subscriptions, Listing events, or digest email.
Seller contact disclosure remains a separate authenticated callable workflow;
the digest contains only approved Listing facts and links.

Firestore Rules enforce active ownership, the exact top-level document shape,
list types, uniqueness for `cardNames`, and separate 100-item bounds. Firestore
Rules cannot validate all nested seller entries at the 100-item product limit
without exceeding the platform's 1,000-expression ceiling. The browser model
and converter validate exact `{ sellerId, followedAt }` entries, while Functions
strictly parse the complete list and reject the entire document from delivery if
any nested entry is malformed. Such malformed owner-written data can disable
only that owner's digest; it cannot expose another user's document or server-only
notification state.

The digest processes at most 100 Gmail recipients sequentially per invocation.
Its explicit 540-second timeout avoids relying on the 60-second default while
leaving a six-minute safety margin before a pre-send reservation becomes stale.
Each `Asia/Taipei` date has one durable run record and one fixed Listing-event
watermark, so Cloud Scheduler retries and overlapping invocations cannot create a
second digest for a user on the same date.

### Firebase Secrets

Set each secret interactively in the Firebase CLI. Do not place any secret in
`.env`, repository variables, source code, issues, or logs.

```sh
firebase functions:secrets:set GMAIL_OAUTH_CLIENT_ID
firebase functions:secrets:set GMAIL_OAUTH_CLIENT_SECRET
firebase functions:secrets:set GMAIL_OAUTH_REFRESH_TOKEN
firebase functions:secrets:set GMAIL_SENDER_ADDRESS
```

The required names are:

- `GMAIL_OAUTH_CLIENT_ID`
- `GMAIL_OAUTH_CLIENT_SECRET`
- `GMAIL_OAUTH_REFRESH_TOKEN`
- `GMAIL_SENDER_ADDRESS`

### Pre-deployment checks

Keep the web deployment and Firebase deployment separate. From the repository
root, run all checks with the intended Firebase web configuration loaded:

```sh
npm test
npm run build
npm run test:rules
npm run test:functions
npm run build:functions
```

Automated deployment verification uses no production Listing and no live email.
It consists of the checks above plus the local Functions manifest contract, so
it does not mutate production notification data or invoke Gmail.

Production commands require explicit operator approval. After the checks pass
and the Blaze, budget alert, and Cloud Run Functions spend cap safeguards are in
place, the seller-subscription release order is **Functions → Rules → frontend**.
Deploy Functions first because the strict digest parser accepts both
legacy and new shapes. Deploy Rules second, then release the frontend immediately
afterward so browser writes always include `sellerSubscriptions`. Run the
approved Firebase deployments separately and exactly as follows:

```sh
firebase deploy --only functions --project conantcgmarket
firebase deploy --only firestore --project conantcgmarket
```

Only after both Firebase deployments succeed should the operator separately
approve and trigger the web-only GitHub Pages frontend deployment.

### Daily digest operator workflow

`dailyDigestOperator` is an HTTP Function deployed with the private Cloud IAM
invoker policy. It never returns a recipient email address. Grant the smallest
possible operator group or user access after deployment; do not grant
`allUsers` or `allAuthenticatedUsers`:

```sh
gcloud functions add-invoker-policy-binding dailyDigestOperator --region=us-central1 --member=user:operator@example.com
```

Run the bounded monitoring request before attempting recovery. It lists at most
50 active claims by default (100 maximum), including the exact UID, claim ID,
state, run date, reservation time, window sequence, and whether a `reserved`
claim is stale:

```sh
gcloud functions call dailyDigestOperator --region=us-central1 --data='{"action":"list","limit":50}'
```

Interpret claim states conservatively:

- `reserved` means the worker has not crossed the durable `beginSend` boundary.
  A fresh reservation can still belong to a running worker. After 15 minutes it
  is older than the 540-second Function timeout and the next digest invocation
  atomically replaces it. If an operator must recover it sooner and has proved
  the worker stopped before `beginSend`, use the exact current claim ID and the
  `definitely-unsent` decision.
- `sending` means the Gmail API call may have been accepted. It is never released
  automatically and rejects `definitely-unsent`. Inspect the dedicated sender's
  Sent mailbox and Cloud Logging, then make the explicit `sent-or-ambiguous`
  decision. That decision advances the reserved cursor and closes the user's run.

Recover a definitely-unsent pre-send reservation only with:

```sh
gcloud functions call dailyDigestOperator --region=us-central1 --data='{"action":"recover","uid":"UID","claimId":"CLAIM_ID","decision":"definitely-unsent"}'
```

Resolve a `sending` claim only with the at-most-once decision:

```sh
gcloud functions call dailyDigestOperator --region=us-central1 --data='{"action":"recover","uid":"UID","claimId":"CLAIM_ID","decision":"sent-or-ambiguous"}'
```

This Gmail boundary intentionally favors at-most-once delivery. If Gmail accepted
the request before returning an ambiguous error, retrying could duplicate the
digest; therefore `sent-or-ambiguous` can omit one digest when the request was in
fact not accepted. A stale or mismatched claim returns a conflict and makes no
state change. Re-run the list action after every recovery and retain the command
and result in the operator incident record.

### Non-invasive deployment verification

Use the automated release gates and local manifest assertion as the deployment
verification evidence. Do not create a production Listing, trigger the scheduled
digest against production data, or send a test email. Production delivery is
verified through monitoring after the separately approved release, without
introducing synthetic Listings or recipients.

Approval of this repository work does not authorize deployment or any production
operation. Verification **must not create a production follow**, must not create
a production Listing, and **must not send a production email**. Inspect only the
deployed manifest/version, Rules release, frontend asset version, aggregate
Function error rates, Scheduler outcomes, digest recipient/send counts, and
Firestore `permission-denied` rates. Do not read owner subscription contents or
invoke a delivery merely as a probe.

Monitor scheduled invocation failures, logged Listing-event capture failures,
active `reserved`/`sending` claims, and unusual changes in daily send volume.
Stop the rollout on unexplained changes. For rollback before the
frontend stage, stop and redeploy the last known Functions or Rules version as
appropriate; no user-created seller follows can exist yet. After frontend
release, prefer a reviewed roll-forward. A full rollback must first pause
subscription management and preserve `notificationSubscriptions`, then restore
compatible Rules, frontend, and Functions in that order; otherwise an older
client could overwrite the new seller-follow field. Every rollback or production
data restoration requires separate explicit approval.
