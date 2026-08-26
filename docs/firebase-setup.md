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

## Notification Functions deployment

Production Cloud Functions require the Firebase Blaze plan. Before setting any
secrets or deploying, upgrade the Firebase project to Blaze, configure a small
budget alert, and set a Cloud Run Functions spend cap appropriate for this MVP.
Review those limits regularly; budget alerts notify after usage accrues and are
not a hard spending limit.

The daily digest schedule runs at 09:00 `Asia/Taipei`.

The Functions package intentionally remains on Node.js 20 because this feature's
accepted implementation plan fixes Node 20 as a global constraint. Upgrading the
runtime belongs in a separate change with its own dependency and deployment
verification.

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
firebase functions:secrets:set DISCORD_LISTINGS_WEBHOOK_URL
firebase functions:secrets:set GMAIL_OAUTH_CLIENT_ID
firebase functions:secrets:set GMAIL_OAUTH_CLIENT_SECRET
firebase functions:secrets:set GMAIL_OAUTH_REFRESH_TOKEN
firebase functions:secrets:set GMAIL_SENDER_ADDRESS
```

The required names are:

- `DISCORD_LISTINGS_WEBHOOK_URL`
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

After the checks pass and the Blaze, budget alert, and Cloud Run Functions
spend cap safeguards are in place, deploy Functions and Firestore artifacts:

```sh
firebase deploy --only functions,firestore
```

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

### Non-production verification checklist

Before using notification delivery in production:

- Use a non-production Listing with a known character and confirm exactly one
  Listing event is captured and delivered to the test Discord webhook.
- Create one test subscriber for that character, enable the email digest, and
  use only that subscriber's verified test Gmail address.
- Trigger or wait for the 09:00 `Asia/Taipei` digest, confirm the single test
  subscriber receives the expected Listing, then confirm the delivery cursor
  advances only after the successful send and the date-keyed run is complete.
- Delete the test Listing and test subscriber, and confirm no production
  webhook, sender account, or subscriber data was used during the check.
