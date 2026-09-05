# Integration and deployment testing

This guide describes the local and CI gates for Conan TCG Market. It is an
operator runbook: use it to run the same checks as CI and to configure the
repository policy that workflow YAML cannot enforce.

## Safety model

The Emulator browser suites (Chromium and WebKit) and Firebase Rules tests use
demo projects and loopback Firebase Emulators: browser E2E uses
`demo-conan-tcg-e2e`, while Rules uses `demo-conan-tcg`. E2E is fail-closed: it
runs only when Emulator mode is explicitly enabled, the project ID starts with
`demo-`, and all configured hosts are loopback. The E2E configuration uses Auth
on `127.0.0.1:9099`, Firestore on `127.0.0.1:8080`, Storage on
`127.0.0.1:9199`, Functions on `127.0.0.1:5001`, and the Vite test server on
`127.0.0.1:4173`.

These checks need no production Firebase credentials, service accounts, Gmail
credentials, or production `.env` values, and perform **no production writes**.
The mocked Google sign-in popup is served by the Auth Emulator; no real Google
OAuth username, password, consent screen, or MFA is used. Digest coverage stops
at a fake Gmail adapter, so no real Gmail is sent.

Account-access scenarios are also Emulator-only. Tests seed server-owned
`accountAccess/{uid}` documents through the Admin harness; the browser can read
only its own document and cannot create, update, or delete access state. A
missing document intentionally resolves active so existing Google accounts need
no migration.

Public Card Master and active-Listing reads remain server-first. If Firestore is
temporarily unavailable, the app may use a non-empty local cache; an empty or
failed cache preserves the original server error so error-state coverage cannot
silently turn a failure into an empty marketplace.

The post-deploy smoke test is deliberately separate. It targets the deployed
production Pages URL and its read-only production-data boundary; it never signs
in or writes. Runtime network guards block Auth sign-in, Functions calls, and
Firebase mutations. A loopback HTTP target is allowed only for the local smoke
procedure below.

## Prerequisites and clean install

Use Node.js 22, the runtime used by Functions and GitHub Actions. Rules and E2E
also require Java 21 for Firebase Emulators. From a clean checkout, install
both packages before running a gate:

```bash
npm ci
npm --prefix functions ci
```

Install the local browsers once (or again after a Playwright upgrade):

```bash
npx playwright install chromium webkit
```

On Linux CI, use `npx playwright install --with-deps chromium webkit` instead.
For `test:quality` in a checkout without an ignored `.env`, scope the six
non-secret demo Firebase values to that command only; do not set
`VITE_FIREBASE_USE_EMULATORS` for that unit/component gate. This prevents a
later production build in the same shell from inheriting demo configuration:

```bash
VITE_FIREBASE_API_KEY=demo-api-key \
VITE_FIREBASE_AUTH_DOMAIN=demo-conan-tcg-e2e.firebaseapp.com \
VITE_FIREBASE_PROJECT_ID=demo-conan-tcg-e2e \
VITE_FIREBASE_STORAGE_BUCKET=demo-conan-tcg-e2e.appspot.com \
VITE_FIREBASE_MESSAGING_SENDER_ID=000000000000 \
VITE_FIREBASE_APP_ID=1:000000000000:web:e2e000000000000000000 \
npm run test:quality
```

Do not use an existing production `.env` for E2E. A local production build may
use the developer's existing `.env`; it is not an E2E input.

## Local gates

Run the gates with Node 22. The order below matches the full local verification
sequence; each command must exit 0.

```bash
# Run test:quality with the scoped command above when no safe local .env exists.
npm run test:rules
npm run test:e2e:chromium
npm run test:e2e:webkit
npm run test:e2e
npm run build
git diff --check
```

`test:quality` runs frontend tests, script contracts, Functions tests and lint,
the Functions build, and an E2E-mode frontend build. `test:rules` starts the
Firestore and Storage Emulators. The Chromium command runs the complete browser
suite, including the Admin harness support specs exactly once; WebKit uses an
iPhone viewport to exercise core flows and every form interaction. `test:e2e`
is the combined Emulator gate: it builds Functions,
owns the Emulator lifecycle and frontend server, resets/seeds state, runs both
browser projects, and cleans up.

For a local read-only smoke test against a deployed site or a loopback server:

```bash
npm run test:smoke -- --base-url <read-only-url>
```

When the URL is a local loopback server, build and serve the E2E artifact—not a
production `dist/` artifact—while all four loopback Firebase services are
available. The production artifact deliberately uses production configuration;
against a local Emulator environment it can remain in a loading state. Use three
terminals:

**Terminal A — start the Emulators:**

```bash
npm run build:functions
npx firebase emulators:start --project demo-conan-tcg-e2e --only auth,firestore,storage,functions
```

**Terminal B — build and serve the E2E artifact:**

```bash
npm run build:e2e
npm run preview -- --host 127.0.0.1 --port 4174 --strictPort
```

**Terminal C — run the smoke:**

```bash
npm run test:smoke -- --base-url http://127.0.0.1:4174/ConanTCGMarket/
```

Stop the preview and Emulator processes after the result is captured. `test:e2e`
builds Functions and owns its own Emulator/frontend lifecycle. This manual
preview smoke sequence does neither, so after a clean install Terminal A must
compile `functions/lib` before starting the Functions Emulator, and Terminal A
and B must remain running. The smoke suite remains network-guarded and
read-only in either case.

Never point a mutating test command at a production Firebase project. The smoke
command is the only deployment-URL command and it is read-only.

## What the suite covers

Every current user operation has at least one named browser spec: public
Marketplace browsing and Card Master-backed filtering, mock authentication and profile,
listing creation/edit/delete and images, subscriptions, sales/dashboard,
authorization failures, and the end-to-end MVP journey. Chromium provides the
full success-path coverage and high-risk business/permission failures. WebKit
adds mobile navigation and each form. Rules tests remain the exhaustive access
matrix where a denied action has no user-visible UI.

| File | Operations covered |
| --- | --- |
| `e2e/public-marketplace.spec.ts` | Notice acknowledgement; public active-listing browsing, filters, ID search, loading, empty, sold-out exclusion, and error state. |
| `e2e/auth-profile.spec.ts` | Signed-out guidance, Profile validation, mock sign-in, create/edit/reload persistence, and sign-out. |
| `e2e/account-access.spec.ts` | Missing-document active compatibility, authenticated read-only suspension, public Marketplace browsing, private held Listings, blocked action routes, and preserved seller history. |
| `e2e/account-moderation.spec.ts` | Admin suspension, resumable Listing hiding, scheduled reconciliation, Marketplace removal, seller read-only hold, restoration, selective republish, immutable history, and direct Rules denial. |
| `e2e/account-appeals.spec.ts` | Suspended-owner zero/three-image submission, reload, one-per-action enforcement, private evidence, admin review, dismissal/approval, restoration invariants, and direct Rules denial. |
| `e2e/listing-lifecycle.spec.ts` | Sell prerequisites and validation, Listing/image creation and trigger event, owner edit/image replacement, inventory protection, and cancel/confirm deletion. |
| `e2e/subscriptions.spec.ts` | Exact-name and seller subscriptions, consent/cancel, persistence/removal, owner/sold/suspended gates, pre-follow exclusion, dual card-and-seller match deduplication, substring coverage, and daily-email preference. |
| `e2e/report-tickets.spec.ts` | Guest guidance; active reporter draft/submission; zero and three evidence images; reload receipt; ownership, account, Listing, MIME, size, read, count, rate-limit, conflicting-retry, and post-submit denial paths. |
| `e2e/admin-moderation.spec.ts` | Active exact-claim admin queue/detail/evidence/decision lifecycle; denial states; filters, pagination, reload, immutable/idempotent and concurrent decisions, atomic violation counts, eligibility without suspension, malformed pairs, and direct Rules denial. |
| `e2e/sales-authorization.spec.ts` | Partial/sold-out sales and Dashboard totals, sale cancellation, cross-seller protection, and signed-out private-route guidance. |
| `e2e/mvp-journey.spec.ts` | Login → Profile → Listing → public search → subscription → sale → public sold-out removal. |
| `e2e/mobile-forms.spec.ts` | iPhone welcome/filter/navigation interaction and every Profile, Listing, edit, sale, subscription, and notification form. |
| `e2e/support/*.spec.ts` | Admin harness reset/seed/Auth behavior and fixed loopback project/port safety checks; included only in Chromium. |
| `e2e/smoke.spec.ts` | Public deployed entry/assets/routes, uncaught runtime errors, and configuration-error checks, with no authentication or mutation. |
| `src/rules/firebaseRules.test.ts` | Listing and seller ownership, active/sold-out reads, Card Master write denial, own-read/server-write-only account access, active/suspended/malformed mutation matrix, Profiles, subscriptions/events/delivery state, Sales immutability, and account-gated per-seller Storage paths. |

Suspended sessions remain authenticated: the UI shows the suspension reason,
removes Profile/Sell/edit/subscription/Sale actions, and preserves a read-only
Dashboard. Firestore and Storage Rules independently deny those mutations, so
the UI is not the security boundary. Account suspension/restoration, automatic
Listing hiding, and selective republish are covered separately by
`e2e/account-moderation.spec.ts`; account appeals are covered separately by
`e2e/account-appeals.spec.ts`.

Seller-subscription E2E uses only the fixed demo project and an in-memory Gmail
fake. Seed coverage preserves both legacy card-name-only subscriptions and new
seller subscriptions, plus Listing events with and without seller UID. The
journey asserts UID-based persistence, Timestamp-backed `followedAt`, reload,
selective removal, pre-follow exclusion, and dual card-and-seller match
deduplication. The suite performs no production follow, Listing, email, or data mutation.
It cannot invoke the production Gmail adapter.

Moderation-report E2E maps the **ten moderation-report acceptance criteria** to
observable boundaries:

1. An active Google buyer without a Seller Profile can enter from another
   seller's active Listing; a guest receives sign-in guidance.
2. Owner, suspended, malformed-account, inactive, and missing-Listing attempts
   are denied.
3. Category and trimmed 1–100-character description validation agree across UI
   and Functions.
4. Zero or three JPEG/PNG/WebP images succeed while wrong MIME, oversized,
   fourth-slot, cross-user, browser-read, and post-submit operations fail.
5. Draft retry returns one draft and the UTC daily limit permits only ten new
   drafts.
6. Finalization reads real object metadata, accepts an exact retry, and rejects a
   conflicting retry.
7. The submitted Firestore document contains the immutable safe Listing snapshot
   and no seller contact, email, or arbitrary field.
8. Report collections remain server-only and evidence remains browser-unreadable.
9. Bounded cleanup removes expired drafts and their slots without touching a
   submitted report or evidence.
10. The browser journey reaches an opaque, reload-stable ticket while all of the
    preceding checks run against the fixed demo project.

The suite and its support adapters perform **no production report, evidence, email, cleanup, or data mutation**.
Do not source a production `.env`, ADC
project, or Firebase project into an Emulator run. These tests prove repository
behavior only; Scheduler delivery, deployed indexes, IAM, quotas, and production
observability require a separately approved non-invasive release verification.

Admin moderation E2E maps the **ten admin-moderation acceptance criteria** to
observable boundaries:

1. A newly submitted report atomically creates its matching open case; an
   incompatible pre-existing case aborts the submission.
2. Only an active account with exact boolean admin claim can list, inspect,
   retrieve evidence, or decide; signed-out, non-admin, suspended, unavailable,
   and malformed account states do not load private data.
3. The queue filters all/open/dismissed/confirmed cases and paginates in a
   bounded deterministic order using safe summaries only.
4. Detail returns the immutable report and approved account/case fields while
   excluding contact, email, arbitrary fields, hashes, and Storage paths.
5. Evidence retrieval verifies immutable metadata, returns exactly one object,
   and the UI replaces and revokes its non-persistent Blob URL.
6. Dismissal records one rationale-backed terminal decision without changing
   account access or violation count.
7. Confirmation closes the case and atomically increments missing, active, or
   suspended account state exactly once; malformed state causes no writes.
8. Exact retries are idempotent, conflicting or concurrent decisions fail
   closed, and the UI displays only trusted returned or reloaded state.
9. Two confirmed violations display manual-suspension eligibility; the separate
   account-moderation workflow owns any explicit suspension action.
10. Reload, mobile layout, direct Firestore/Storage denial, error retry, and the
    full queue → detail → evidence → decision path run only in the fixed demo
    Emulator project.

This suite performs **no production report read, evidence download, decision, violation-count change, email, or data mutation**.
Emulator success proves
repository behavior, not deployed index readiness, IAM, quotas, production
latency, or operational monitoring. Those require a separately approved,
non-invasive verification that inspects only versions and aggregate sanitized
signals.

Account-moderation E2E maps the **ten account-moderation acceptance criteria**
to observable boundaries:

1. Only an active exact-claim admin, acting on a confirmed non-self case whose
   target has at least two confirmed violations, can request suspension.
2. The first transaction blocks privileges and creates one admin-bound,
   idempotent operation plus an immutable request event.
3. In-request draining and the exact scheduled handler hide active Listings in
   bounded pages and durably complete an interrupted operation.
4. Exact retries resume one action; conflicting, concurrent, malformed, stale,
   and self-target operations fail closed.
5. Marketplace and direct non-owner reads exclude held Listings while the
   authenticated suspended owner retains a read-only Dashboard and history.
6. Sold-out Listings, Sales, images, inventory, existing Listing events, and
   confirmed-violation counts survive suspension unchanged.
7. Restoration requires the completed exact action and reactivates only the
   account; held Listings remain held.
8. Only the restored owner can edit, delete, or selectively republish one held
   Listing; republish is idempotent and does not create a Listing event.
9. Operation and audit collections deny every browser identity, while the admin
   detail shows only strict, newest-first, bounded history projections.
10. Chromium and iPhone WebKit cover progress, dialogs, reload persistence,
    generic errors, history, held sections, confirmation, and Rules denial in the
    fixed demo project.

These tests perform **no production moderation read, suspension/restoration,
Listing hide/republish, email, deployment, or data mutation**. They invoke only
demo Emulators and the locally compiled scheduled handler. Production index and
schedule readiness require a separately approved non-invasive verification.
In exact gate terms, they perform no production moderation read, suspension/restoration, Listing hide/republish, email, deployment, or data mutation.

Account-appeal E2E maps the **ten account-appeal acceptance criteria** to
observable boundaries:

1. Only the currently suspended authenticated target can submit an appeal for
   the exact completed suspension action.
2. A trimmed 100–2,000-character statement, request identity, draft identity,
   evidence count, MIME, size, generation, and path are validated consistently.
3. Zero and three-image submissions work; one appeal per action and exact retry
   semantics prevent duplicate records and counters.
4. Firestore appeal/audit collections and submitted Storage evidence deny every
   direct browser read or write, including owner and admin identities.
5. Only an active exact-claim non-target admin can reach the bounded queue,
   detail, and generation-verified evidence response.
6. Dismissal records one immutable rationale and leaves the target suspension,
   operation, counts, Listings, Sales, cases, and prior history unchanged.
7. Approval atomically reuses the exact-action restoration path without reducing
   confirmed counts or republishing a held Listing.
8. Malformed, stale, self-review, ordinary-user, conflicting, and concurrent
   operations fail closed in the callable and pure transaction suites.
9. Bounded cleanup deletes only expired unsubmitted draft objects after 24 hours
   and never deletes generation-bound submitted evidence.
10. Chromium covers submit → private review → dismiss/approve and direct denial;
    iPhone WebKit proves the suspended-owner form remains usable without
    horizontal overflow in the fixed demo project.

These tests perform **no production appeal, evidence, decision, account restoration, Listing republish, email, deployment, or data mutation**.
Scheduler
execution, deployed indexes, IAM, quotas, and production monitoring require a
separately approved non-invasive verification.

## Reliability and evidence

Playwright uses one worker. Local retries are disabled; CI permits one retry to
capture diagnostics but `failOnFlakyTests` makes a retry-only pass fail the CI
gate. The E2E Vite server is always newly owned by Playwright and never reuses a
process already listening on port 4173. Do not add fixed `waitForTimeout`
sleeps—use web-first assertions and
bounded Emulator-state polling.

Local evidence is written to ignored `playwright-report/`, `test-results/`, and
`*-debug.log` files. CI retains traces, failure screenshots/videos, HTML
reports, and Firebase Emulator logs for 14 days. CI artifact uploads use their
failure/always conditions so an earlier test failure does not hide the evidence.
`firebase emulators:exec` owns Emulator teardown after its child command exits.
Treat a flaky retry as a failure: inspect the retained trace and
Emulator logs, reproduce locally with the relevant project, and fix or quarantine
only after preserving a deterministic regression case.

## CI and deployment behavior

One workflow has five jobs:

```text
quality ─┐
rules   ├─> deploy (main push only) ─> smoke
e2e     ┘
```

Pull requests to `main` run `quality`, `rules`, and `e2e`, but never deploy.
Pushes to `main` rerun those three gates; only their success permits the Pages
deployment. The deploy job alone receives the production Firebase repository
variables (`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
`VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`,
`VITE_FIREBASE_MESSAGING_SENDER_ID`, and `VITE_FIREBASE_APP_ID`) to build the
production artifact. Test jobs receive demo values or no credentials, never
production values or Gmail secrets.

Concurrency cancellation applies only to pull-request runs. A newer `main`
push cannot cancel a deploy after publication but before its required smoke;
that deploy-and-smoke chain always reaches a terminal result.

After deployment, `smoke` checks the public entry, assets, approved hash routes,
configuration errors, and any uncaught page exception without authentication or
writes. A smoke failure marks the workflow failed and preserves its evidence,
but it does not roll back the already-published Pages version.

### Manual GitHub repository settings

Workflow YAML cannot make a check required or prevent a direct push by itself.
For the `main` branch, configure branch protection/rulesets to require the
`quality`, `rules`, and `e2e` checks before merging. Enable required pull
requests if direct pushes must also be prevented. Review the Pages environment
and repository variables above separately; do not place them in test-job
secrets.

## Troubleshooting

- **Wrong Node or Java:** confirm Node 22 and Java 21 are selected, then repeat
  the clean installs. A different Node runtime can create unrelated test
  failures; Java is required before the Emulator commands can start.
- **Port already in use:** stop the process holding 9099, 8080, 9199, 5001,
  the E2E server port 4173, or the manual smoke-preview port 4174, then rerun
  the command. Do not change the tracked loopback ports just to work around a
  stale local process.
- **Browser executable missing:** run `npx playwright install chromium webkit`
  locally, or the `--with-deps` variant in Linux CI.
- **ADC warning:** Emulator tests do not need Application Default Credentials.
  Ensure the `demo-` project and tracked E2E environment are active; do not
  "fix" an Emulator run by supplying production credentials.
- **Failure or flaky retry:** retain and inspect `playwright-report/`,
  `test-results/`, and Emulator debug logs before rerunning. A retry-only CI
  pass remains a failed gate by policy.

## Emulator limits and staging triggers

The Emulators prove application and Rules behavior, but they are not a
production-equivalence environment. They do not validate Firestore composite
indexes, all production transaction locking/service limits, Functions IAM,
container limits or retry behavior, Storage CORS/IAM/retention, or real Google
OAuth domains and consent behavior. They also cannot validate real third-party
delivery, real Gmail OAuth/delivery, provider-specific behavior, scheduled or
event behavior as it runs in production, production-like data volume, index
behavior, performance, or cross-region effects.

Create a fully isolated staging Firebase/Google Cloud project only when one of
those conditions requires validation. Use fake data, separate credentials and
sender identities, budget alerts, least-privilege IAM, GitHub Environment
approval, and cleanup. Normal CI remains Emulator-only after staging exists.

`TODO.md` is a local, uncommitted working tracker for completed work, manual
branch-protection setup, and future staging/GitHub-Issue follow-up; do not stage
or commit it with this feature.
