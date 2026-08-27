# Emulator Integration / E2E Deployment Gates Design

## Summary

Conan TCG Market already has frontend unit/component tests, Functions tests,
Firebase Rules Emulator tests, and production builds. The GitHub Pages workflow
currently builds and deploys on every push to `main`, but it does not run those
tests and it has no browser-level integration coverage.

This design adds deterministic, deploy-blocking integration and end-to-end
tests for every operation currently available to a user. Tests run only against
the Firebase Local Emulator Suite. Pull requests and `main` pushes share the
same required quality gates. A GitHub Pages deployment happens only after all
pre-deploy gates pass, followed by a read-only production smoke test.

## Goals

- Exercise every user-visible operation through a real browser and the real
  frontend Firebase SDKs.
- Verify Auth, Firestore, Storage, Security Rules, and the Listing event trigger
  without writing production data.
- Keep exhaustive field-boundary checks in fast unit/component tests while E2E
  covers complete success flows and important permission/business failures.
- Block GitHub Pages deployment when frontend, Functions, Rules, E2E, or build
  gates fail.
- Run the same gates before a pull request can be merged, once repository rules
  mark them as required checks.
- Produce enough failure evidence to diagnose CI-only and mobile-WebKit issues.
- Keep implementation progress and future staging needs in the local
  `TODO.md` working file without adding that file to version control.

## Non-Goals

- Do not connect CI to production Firestore, Storage, Auth, or Functions.
- Do not create a staging Firebase project in the first version.
- Do not automate a real Google account login.
- Do not send a real Gmail daily digest.
- Do not auto-rollback a GitHub Pages deployment after a smoke-test failure.
- Do not auto-create GitHub Issues in the first version.
- Do not repeat every unit-level validation permutation in Playwright.
- Do not run every browser scenario in Chromium, Firefox, and WebKit.

## Fixed Decisions

- Use a Firebase demo project ID and local Emulators only.
- Chromium desktop runs the complete E2E suite.
- WebKit with an iPhone viewport runs core flows and every form interaction.
- Playwright runs with one worker initially; stability is preferred over speed.
- A cold CI run may take approximately 10–15 minutes.
- Pull requests run all pre-deploy gates but never deploy.
- Pushes to `main` rerun all gates before GitHub Pages deployment.
- Post-deploy smoke tests are read-only and mark the workflow failed without
  rolling back the already-published site.
- Daily digest tests stop at message generation and a fake Gmail adapter.
- Every user operation receives a success path; high-risk operations also
  receive their main authorization and business-rule failure paths.

## CI Architecture

The existing Pages workflow becomes one layered workflow with five jobs.

### `quality`

- Checkout the repository.
- Set up Node.js 22.
- Run deterministic `npm ci` in the root and in `functions/`.
- Run frontend unit/component tests.
- Run Functions tests, lint, and TypeScript build.
- Run a frontend build with non-production demo configuration.
- Run workflow/E2E contract tests.

The repository will add `functions/package-lock.json`; the Functions package
continues to be a separate package rather than becoming an npm workspace.

### `rules`

- Set up Node.js 22 and Java 21.
- Restore the Firebase Emulator JAR cache.
- Install dependencies with `npm ci`.
- Run the existing Firestore/Storage Rules Emulator suite.
- Upload Emulator logs on failure.

### `e2e`

- Set up Node.js 22 and Java 21.
- Restore the Firebase Emulator JAR cache.
- Install root and Functions dependencies.
- Install Playwright Chromium and WebKit with their Linux dependencies.
- Build Functions.
- Start Auth, Firestore, Storage, and Functions Emulators under one demo project.
- Start the frontend with the tracked E2E Firebase configuration.
- Reset and seed Emulator state.
- Run the Chromium and WebKit projects using one worker.
- Upload Playwright and Emulator artifacts even when tests fail.

### `deploy`

- Run only for a push to `main`.
- Depend on `quality`, `rules`, and `e2e`.
- Obtain `pages: write` and `id-token: write`; other jobs retain only
  `contents: read`.
- Use the existing repository Firebase variables to build the production
  artifact only after all gates pass.
- Upload and deploy the Pages artifact.
- Expose the deployment URL for the smoke job.

The production artifact is intentionally built after the gates instead of in a
pull-request job. Fork pull requests therefore need no production variables,
and a failed gate does not produce a candidate production artifact.

### `smoke`

- Depend on the successful `deploy` job.
- Install Chromium only.
- Run the read-only smoke project against the deployment output URL.
- Upload trace, screenshots, video, and HTML report on failure.
- Mark the workflow failed on a smoke failure, but do not auto-rollback.

GitHub repository rules must separately mark `quality`, `rules`, and `e2e` as
required checks. Workflow YAML alone cannot prevent a maintainer from merging
or directly pushing outside branch-protection policy.

## Firebase Emulator Mode

The frontend gains an explicit E2E-only Emulator configuration. It does not
infer Emulator use merely because the page runs on localhost.

Tracked `.env.e2e` values include:

```text
VITE_FIREBASE_USE_EMULATORS=true
VITE_FIREBASE_PROJECT_ID=demo-conan-tcg-e2e
```

The remaining Firebase web configuration fields use non-secret demo values.
The app connects to:

- Auth: `127.0.0.1:9099`
- Firestore: `127.0.0.1:8080`
- Storage: `127.0.0.1:9199`
- Functions: `127.0.0.1:5001`

The configuration fails closed unless all of the following are true:

- Emulator mode is explicitly enabled.
- The Firebase project ID starts with `demo-`.
- Every configured Emulator host is loopback.

Unit tests prove invalid combinations throw before the app performs a Firebase
operation. Production builds do not enable Emulator mode. CI E2E jobs do not
receive production Firebase variables, service accounts, Gmail credentials, or
other production secrets.

## Authentication Strategy

E2E tests click the existing `使用 Google 登入` control and exercise the real
`signInWithPopup` path. The popup is served by the Firebase Authentication
Emulator and creates deterministic mock Google identities. No real Google
username, password, MFA, OAuth consent, or anti-bot flow is automated.

The test harness may use the Auth Emulator REST API to reset and inspect mock
accounts. It must not add a test login endpoint or production-accessible login
backdoor to the application.

## Test Data Lifecycle

The harness uses Firebase Admin SDKs and Emulator REST APIs configured with the
same `demo-conan-tcg-e2e` project ID.

For each spec:

1. Verify all required Emulator hosts are present.
2. Clear Auth, Firestore, and Storage Emulator state.
3. Seed only the Card Master, users, Profiles, Listings, Sales, and
   subscriptions required by that spec.
4. Use a stable namespace such as `e2e-profile-*` or `e2e-listing-*`.
5. Run the browser scenario.
6. Execute teardown even after a failed assertion.

If reset or seed fails, the suite stops immediately rather than continuing with
unknown state. Tests do not depend on spec order. Small checked-in PNG fixtures
exercise upload, replacement, download, and deletion without large artifacts.

## Browser Projects

### Chromium desktop

Chromium runs the complete suite with a desktop viewport.

### WebKit iPhone

WebKit uses a fixed iPhone device/viewport, touch input, and mobile media
settings. It covers:

- Welcome dialog and Auth.
- Marketplace metadata controls, filters, and result navigation.
- Profile form.
- Every Listing creation field and file picker.
- Listing details and subscriptions.
- Listing edit form, sale modal, and deletion confirmation.
- Subscription management and the email checkbox.
- Horizontal overflow and overlapping-interaction regressions.

WebKit does not repeat the complete backend authorization matrix already covered
by Chromium and Rules tests.

### Post-deploy Chromium smoke

The smoke project is separate from Emulator E2E. It is prohibited from signing
in or sending Firebase writes.

## E2E Coverage Matrix

### `welcome-and-public-marketplace`

- Display, acknowledge, and persist the initial notice.
- Verify the rugiacreation attribution URL without navigating away.
- Read Card Master data.
- Exercise loading, empty, and populated marketplace states.
- Filter and clear by card type/name, rarity, ID, sleeve, and MyShip.
- Show active Listings and exclude sold-out Listings.
- Open Listing details, images, seller name, contact data, and conditions.

### `card-master`

- Open the standalone Card Master route from its public navigation state.
- Exercise loading, empty, error, and populated states.
- Search by partial card name and show the matching card type, complete name,
  visible ID, and rarities.
- Select a result, verify its complete summary, and clear the selection.
- Verify a query with no matches shows the empty result state.

### `authentication-and-profile`

- Sign in through the mock Google popup.
- Display authenticated navigation.
- Create a seller Profile.
- Edit display name, contact type, and contact value.
- Persist across reload.
- Sign out and show the unauthenticated Profile state.

### `listing-create`

- Guide a user without a Profile to Profile setup.
- Select card type, complete card name, rarity, and ID.
- Exercise required-field and unknown-Card-Master errors.
- Upload one to three images.
- Set price, quantity, sleeve/packaging fee, MyShip/fee, and note.
- Verify Firestore Listing shape, Storage objects, detail page, and marketplace.
- Verify the Firestore-triggered generic Listing event appears through the
  Functions Emulator.

### `listing-edit-delete`

- Allow only the owner into management.
- Edit price, inventory, conditions, fees, and note.
- Replace images and verify old images are removed after the Listing update.
- Reject inventory below the sold quantity.
- Cancel a deletion confirmation.
- Confirm deletion and verify both Listing and referenced images disappear.

### `subscriptions`

- Show unauthenticated guidance.
- Subscribe to a complete Card Master name with explicit daily-email consent.
- Display raw-substring covered state.
- Subscribe from marketplace and Listing detail surfaces.
- List exact names under `我的訂閱`.
- Toggle daily email.
- Remove one name and then the last name.
- Persist canonical server state across reload.

### `sales-and-dashboard`

- Split active and sold-out Listings.
- Render active count, sold quantity, and revenue.
- Open and cancel the sale modal.
- Reject invalid quantity, invalid price, and oversell attempts.
- Record a partial sale and verify inventory/revenue.
- Sell out the remaining inventory and remove the Listing from public results.
- Keep the sold-out Listing visible to its owner.

### `authorization`

- Reject unauthenticated writes.
- Reject another seller editing, deleting, or recording a sale on a Listing.
- Reject cross-user private subscription access.
- Reject public reads of sold-out Listings.
- Reject Card Master client writes.
- Reject cross-seller Storage paths.

These cases are exercised through the browser when a user-visible result exists
and directly through Emulator clients when the denied operation has no exposed
UI. Existing Rules tests remain the authoritative exhaustive access matrix.

### `mvp-journey`

One short cross-module flow verifies that the subsystems compose:

```text
mock Google login → Profile → Listing with image → public search → subscription
→ partial sale → sold out → removed from public marketplace
```

This journey supplements rather than replaces isolated specs. A failure in one
isolated feature must not prevent unrelated operations from being tested.

## Functions and Gmail Boundary

The Functions Emulator verifies the Firestore Listing-create trigger and the
generic Listing event written by `captureListingEvent`.

Daily digest behavior remains a Functions integration suite with injected
dependencies:

- Raw case-sensitive substring matching.
- Event pagination and recipient cap.
- No-match completion without sending.
- Message text and HTML.
- Fake Gmail adapter invocation.
- Claim, retry ambiguity, and recovery behavior.

No Gmail OAuth secret is present in E2E or CI, and no email is sent.

## Playwright Reliability Policy

- `workers: 1` in CI and initially during local full runs.
- Local retries: `0`.
- CI retries: `1` for diagnostic capture.
- `failOnFlakyTests: true` in CI, so a retry-only pass still blocks deploy.
- `forbidOnly: true` in CI.
- Per-test timeout: 30 seconds.
- E2E job timeout: 20 minutes.
- Fixed sleeps such as `waitForTimeout` are prohibited.
- UI changes use Playwright web-first assertions.
- Backend effects use bounded polling of Emulator state.

The repository keeps report/test-result directories ignored. On failure or
flakiness, Actions retain for 14 days:

- Playwright trace.
- Failure screenshot.
- Failure video.
- HTML report.
- Firebase Emulator logs.

Artifact upload and teardown run with `if: always()` so an earlier assertion
cannot hide the evidence.

## Post-Deploy Smoke Contract

The smoke suite verifies:

- The `/ConanTCGMarket/` entry point responds and renders.
- Referenced JavaScript and CSS assets load.
- The main heading and welcome dialog render.
- Important hash routes render their signed-out/public state.
- No uncaught page error or Firebase configuration error occurs.
- The rugiacreation link has the approved URL.

It does not authenticate, upload, create a Listing, change a subscription, or
otherwise write Firebase. A failure marks the workflow red and preserves
artifacts, but the already-deployed version stays live. A later feature may
create or update a GitHub Issue for smoke failures.

## Files and Commands

Expected new or modified files include:

```text
.github/workflows/deploy.yml
.env.e2e
.gitignore
firebase.json
functions/package-lock.json
package.json
package-lock.json
playwright.config.ts
playwright.smoke.config.ts
src/lib/firebase/emulators.ts
src/lib/firebase/emulators.test.ts
e2e/fixtures/*.png
e2e/support/*
e2e/*.spec.ts
scripts/e2e-contract.test.mjs
scripts/workflow-contract.test.mjs
docs/integration-testing.md
```

`TODO.md` remains a local working tracker and is intentionally not staged or
committed as part of this feature.

Developer-facing commands:

```bash
npm run test:quality
npm run test:rules
npm run test:e2e
npm run test:e2e:chromium
npm run test:e2e:webkit
npm run test:smoke -- --base-url <deployment-url>
```

`npm run test:e2e` owns Functions build, Emulator lifecycle, frontend E2E
server, reset/seed, both browser projects, and cleanup.

Contract tests inspect the workflow and Playwright configuration so future
refactors cannot silently remove required gates, projects, single-worker mode,
artifact policy, deployment dependencies, or post-deploy smoke.

## Known Emulator Limitations and Staging Trigger

No staging project is required initially. Emulator limitations remain visible
in this design and in the local `TODO.md` working tracker:

- Firestore Emulator does not enforce composite indexes and does not reproduce
  all production transaction locking or service limits.
- Functions Emulator does not reproduce IAM, production container resource
  limits, or failure retries.
- Storage Emulator does not reproduce bucket-level CORS, IAM, or retention.
- Auth Emulator cannot prove real Google OAuth domains and consent behavior.

Create a fully isolated staging Firebase/Google Cloud project when the team
needs to validate one of those behaviors, real Gmail OAuth/delivery, or a
production-like manual acceptance pass. Staging must use fake data, separate
credentials and sender identities, budget alerts, least-privilege IAM, GitHub
Environment approval, and cleanup. Normal CI continues to use Emulators even
after staging exists.

## Completion Criteria

- All existing tests and builds remain green.
- Every listed user operation has the approved Chromium coverage.
- All specified mobile/form interactions pass WebKit iPhone coverage.
- Browser tests prove Firestore and Storage side effects against Emulators.
- Listing creation proves the generic Functions event trigger.
- CI has no production Firebase or Gmail secrets outside the production Pages
  build variables already used by the repository.
- Pull requests report `quality`, `rules`, and `e2e` checks.
- A `main` push cannot enter the deploy job unless all three checks pass.
- A successful deploy is followed by the read-only smoke test.
- Failures upload the agreed evidence and flaky retries still block deployment.
- `docs/integration-testing.md` explains local use and troubleshooting.
- The local, uncommitted `TODO.md` records completed work, manual
  branch-protection setup, and future staging/GitHub-Issue tasks.
