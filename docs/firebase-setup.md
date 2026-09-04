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
web frontend. Do not use the notification section's Rules-first ordering for
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
place, use this fixed release order:

Rules first, Functions second, and frontend third. Run the approved Firebase
deployments separately and exactly as follows:

```sh
firebase deploy --only firestore --project conantcgmarket
firebase deploy --only functions --project conantcgmarket
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
