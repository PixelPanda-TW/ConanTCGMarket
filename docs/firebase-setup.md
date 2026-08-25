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

## Notification Functions deployment

Production Cloud Functions require the Firebase Blaze plan. Before setting any
secrets or deploying, upgrade the Firebase project to Blaze, configure a small
budget alert, and set a Cloud Run Functions spend cap appropriate for this MVP.
Review those limits regularly; budget alerts notify after usage accrues and are
not a hard spending limit.

The daily digest schedule runs at 09:00 `Asia/Taipei`.

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

### Non-production verification checklist

Before using notification delivery in production:

- Use a non-production Listing with a known character and confirm exactly one
  Listing event is captured and delivered to the test Discord webhook.
- Create one test subscriber for that character, enable the email digest, and
  use only that subscriber's verified test Gmail address.
- Trigger or wait for the 09:00 `Asia/Taipei` digest, confirm the single test
  subscriber receives the expected Listing, then confirm the delivery cursor
  advances only after the successful send.
- Delete the test Listing and test subscriber, and confirm no production
  webhook, sender account, or subscriber data was used during the check.
