# Batch 7 Seller Subscriptions Implementation Plan

> **Required execution discipline:** execute tasks in order. For every behavior
> change, first run a focused test that fails for the intended reason, make the
> smallest production change, rerun GREEN, and commit before continuing. Use
> Node 22. Emulator tests must use only fixed `demo-*` project IDs and loopback
> hosts. Do not deploy, assign a production claim, create a production follow,
> send a live email, or mutate production data.

**Goal:** Add active-buyer seller follows to Listing detail and the existing
notification settings page, then include only post-follow Listings from those
sellers in the existing daily digest.

**Architecture:** Extend the owner-scoped notification document with canonical
`sellerSubscriptions` entries containing seller UID and follow time. Extend new
Listing-event snapshots with seller UID while retaining legacy reads. Reuse the
transactional browser repository and at-most-once daily digest; matching becomes
card-name OR followed-seller with Listing-ID deduplication.

**Spec:**
`docs/superpowers/specs/2026-09-04-batch-7-seller-subscriptions-design.md`

## Task 1: Extend the frontend subscription domain and Firestore converter

**Files:**

- Modify: `src/domain/models/notificationSubscription.ts`
- Modify: `src/domain/models/domainModels.test.ts`
- Modify: `src/data/firestore/converters.ts`
- Modify: `src/data/firestore/converters.test.ts`

1. Add failing domain tests for exact `{sellerId, followedAt}` entries,
   uniqueness, trimmed 1–128-character IDs, valid dates, deterministic seller-ID
   ordering, the 100-entry limit, and rejection of extra fields.
2. Add failing converter tests proving legacy documents without
   `sellerSubscriptions` read as `[]`, new documents convert Timestamp↔Date,
   canonical writes always include the field, and unknown/partial shapes fail.
3. Add `SellerSubscription`, the new array field, and strict validators. Keep
   existing card-name semantics and independent limits unchanged.
4. Update `notificationSubscriptionConverter` and the raw document reader with
   one explicit legacy branch and one exact new-shape branch.
5. Run:

   ```sh
   npm test -- src/domain/models/domainModels.test.ts src/data/firestore/converters.test.ts
   ```

6. Commit:

   ```sh
   git add src/domain/models/notificationSubscription.ts src/domain/models/domainModels.test.ts src/data/firestore/converters.ts src/data/firestore/converters.test.ts
   git commit -m "feat: model seller subscriptions"
   ```

## Task 2: Add transactional seller-follow repository operations

**Files:**

- Modify: `src/data/firestore/repositories/notificationSubscriptionRepository.ts`
- Modify: `src/data/firestore/repositories/notificationSubscriptionRepository.test.ts`
- Modify if needed: `src/data/firestore/repositories/index.ts`

1. Add failing tests for owner-only add/remove, canonical seller validation,
   follow-time persistence, sorted entries, idempotent re-add retaining the
   original time, idempotent missing removal, and preservation of card names and
   email preference.
2. Add `addNotificationSeller` and `removeNotificationSeller` through the
   existing transaction helper. Adding enables daily email; removing only the
   requested seller and never deletes the document.
3. Prove concurrent transaction callbacks consume the latest snapshot rather
   than a component's stale copy.
4. Run the focused repository suite and commit:

   ```sh
   npm test -- src/data/firestore/repositories/notificationSubscriptionRepository.test.ts
   git add src/data/firestore/repositories/notificationSubscriptionRepository.ts src/data/firestore/repositories/notificationSubscriptionRepository.test.ts src/data/firestore/repositories/index.ts
   git commit -m "feat: persist seller subscriptions"
   ```

## Task 3: Capture seller identity in new Listing events

**Files:**

- Modify: `functions/src/domain.ts`
- Modify: `functions/src/domain.test.ts`
- Modify: `functions/src/listingEvents.test.ts`
- Modify: `functions/src/index.ts`
- Modify: `functions/src/index.test.ts`

1. Add failing tests proving new event capture requires and stores the exact
   Listing `sellerId`, strips unrelated seller/contact fields, and rejects
   missing, blank, oversized, or non-string IDs.
2. Add read tests proving old stored events without seller ID remain valid,
   valid new events round-trip, and malformed present IDs fail closed.
3. Extend `ListingSnapshot`, `ListingEvent`, `ListingEventDraft`, field
   allowlists, `toListingEvent`, and Admin adapter storage. Make `sellerId`
   optional only on the stored/read type to express legacy events.
4. Reprove event idempotency, pagination, Discord-disabled behavior, and no
   contact leakage.
5. Run focused Functions tests and commit:

   ```sh
   npm --prefix functions test -- --run src/domain.test.ts src/listingEvents.test.ts src/index.test.ts
   git add functions/src/domain.ts functions/src/domain.test.ts functions/src/listingEvents.test.ts functions/src/index.ts functions/src/index.test.ts
   git commit -m "feat: capture listing seller identity"
   ```

## Task 4: Add strict server-side seller subscription matching

**Files:**

- Create: `functions/src/sellerSubscriptions.ts`
- Create: `functions/src/sellerSubscriptions.test.ts`
- Modify: `functions/src/dailyDigest.ts`
- Modify: `functions/src/dailyDigest.test.ts`

1. Add failing pure-domain tests for exact seller entry parsing from Admin
   Timestamps, 100-entry bound, unique IDs, deterministic order, invalid dates,
   extra fields, seller equality, and inclusive `capturedAt >= followedAt`.
2. Add failing digest tests for seller-only recipients, pre-follow exclusion,
   post-follow inclusion, card-name OR seller matching, dual-match deduplication,
   legacy seller-ID-less events, malformed seller entries, and empty criteria.
3. Implement strict parsing and `matchesSubscribedSeller`. Extend the digest
   subscription shape with optional legacy `sellerSubscriptions` input and
   normalize it before claiming a recipient.
4. Preserve the current recipient cap, shared event scan, individual sequence
   windows, sort/group output, no-match completion, reservation release,
   `beginSend`, Gmail ambiguity, and batch cursor logic exactly.
5. Run the two focused suites and commit:

   ```sh
   npm --prefix functions test -- --run src/sellerSubscriptions.test.ts src/dailyDigest.test.ts
   git add functions/src/sellerSubscriptions.ts functions/src/sellerSubscriptions.test.ts functions/src/dailyDigest.ts functions/src/dailyDigest.test.ts
   git commit -m "feat: match followed sellers in daily digest"
   ```

## Task 5: Adapt Functions persistence for compatible subscription shapes

**Files:**

- Modify: `functions/src/index.ts`
- Modify: `functions/src/index.test.ts`

1. Add failing adapter tests with one legacy card-only subscription and one new
   seller subscription. Assert Timestamp values remain server timestamps and no
   contact/profile fields enter digest data.
2. Update the email-enabled subscription adapter to pass the optional seller
   entries without weakening existing exact field validation. Update the event
   adapter to return optional legacy/new seller IDs.
3. Prove bounded queries and the exported Function manifest are unchanged.
4. Run focused index + digest tests and commit:

   ```sh
   npm --prefix functions test -- --run src/index.test.ts src/dailyDigest.test.ts
   git add functions/src/index.ts functions/src/index.test.ts
   git commit -m "feat: load seller digest subscriptions"
   ```

## Task 6: Build the seller subscription control

**Files:**

- Create: `src/features/notifications/SellerSubscriptionControl.tsx`
- Create: `src/features/notifications/SellerSubscriptionControl.test.tsx`
- Modify: `src/styles.css`

1. Add failing component tests for guest guidance, active loading/unfollowed/
   followed states, daily-email consent, disabled confirm, add/remove payloads,
   pending single-flight, generic failures, cancellation/focus return, suspended
   and unavailable states, and stale Listing/account async results.
2. Implement the control using the account-access gates and committed-context
   pattern already proven by `CardNameSubscriptionControl`.
3. The component accepts only `{sellerId, sellerName}`. It never reads contact
   data, never infers a seller from display name, and emits no control for self.
4. Add minimal responsive styles using existing tokens and 44px interactive
   targets. Run focused tests and commit:

   ```sh
   npm test -- src/features/notifications/SellerSubscriptionControl.test.tsx
   git add src/features/notifications/SellerSubscriptionControl.tsx src/features/notifications/SellerSubscriptionControl.test.tsx src/styles.css
   git commit -m "feat: add seller subscription control"
   ```

## Task 7: Wire seller follows into Listing detail

**Files:**

- Modify: `src/features/listings/ListingPage.tsx`
- Modify: `src/features/listings/ListingPage.test.tsx`

1. Add failing tests proving an active non-owner Listing passes exact seller UID
   and current display name to the control; owner, sold-out, suspended, missing,
   and loading contexts cannot mutate.
2. Render the seller control next to the seller identity without coupling it to
   Card Master resolution or contact reveal state.
3. Reprove contact disclosure, card-name subscription, edit ownership, legacy
   metadata, and sold-out owner visibility.
4. Run focused Listing tests and commit:

   ```sh
   npm test -- src/features/listings/ListingPage.test.tsx
   git add src/features/listings/ListingPage.tsx src/features/listings/ListingPage.test.tsx
   git commit -m "feat: follow sellers from listings"
   ```

## Task 8: Manage followed sellers on the notification page

**Files:**

- Modify: `src/features/notifications/NotificationSettingsPage.tsx`
- Modify: `src/features/notifications/NotificationSettingsPage.test.tsx`
- Modify: `src/styles.css`

1. Add failing tests for the new seller section, per-ID public-profile loading,
   zh-Hant name ordering with UID tie-break, isolated profile failures, missing
   profile fallback, exact removal, pending/error handling, stale account
   results, and preservation of card-name UI.
2. Load only public seller profiles after the owner subscription resolves. Keep
   entries removable when a profile cannot be loaded.
3. Update daily-email copy to cover card names and followed sellers; keep one
   global preference and existing account gates.
4. Run focused settings tests and commit:

   ```sh
   npm test -- src/features/notifications/NotificationSettingsPage.test.tsx
   git add src/features/notifications/NotificationSettingsPage.tsx src/features/notifications/NotificationSettingsPage.test.tsx src/styles.css
   git commit -m "feat: manage followed sellers"
   ```

## Task 9: Extend Firestore Rules without weakening owner isolation

**Files:**

- Modify: `firestore.rules`
- Modify: `src/rules/firebaseRules.test.ts`

1. Add failing Emulator tests for bounded new-shape owner create/update/delete,
   legacy owner reads, and denials for anonymous, cross-user, suspended,
   malformed/extra-field, non-list, or over-100 seller entries.
2. Recognize exactly the legacy and new top-level document shapes. Require the
   new `sellerSubscriptions` list and bound its length; retain the existing card
   name validation and active-owner gate.
3. Reprove that Listing events, delivery state/runs/batch cursors, seller
   contacts, and moderation collections remain browser-inaccessible.
4. Run `npm run test:rules`, then subscription repository tests, and commit:

   ```sh
   git add firestore.rules src/rules/firebaseRules.test.ts
   git commit -m "security: allow bounded seller subscriptions"
   ```

## Task 10: Prove the seller-subscription journey in Chromium E2E

**Files:**

- Modify: `e2e/support/emulator-state.ts`
- Modify: `e2e/support/emulator-state.spec.ts`
- Modify: `e2e/subscriptions.spec.ts`
- Modify if needed: `functions/src/fakes.ts`

1. Extend Emulator seeding for legacy/new subscription entries and new/legacy
   Listing events with exact Timestamp bodies.
2. Add an active buyer journey: open another seller's active Listing, sign in,
   confirm daily email, follow, verify the exact document, reload, see followed
   state, remove it in `#/notifications`, and verify card subscriptions remain.
3. Add suspended/owner/sold-out browser assertions with no repository mutation.
4. Invoke only the local fake digest path to prove a pre-follow event is
   excluded, a post-follow seller event is included, and an event matching both
   card and seller criteria appears once. Assert no contact value enters output.
5. Run the focused Chromium file through the fixed demo Emulators, repair only
   selector/support issues, rerun GREEN, and commit:

   ```sh
   git add e2e/support/emulator-state.ts e2e/support/emulator-state.spec.ts e2e/subscriptions.spec.ts functions/src/fakes.ts
   git commit -m "test: verify seller subscriptions end to end"
   ```

## Task 11: Document compatibility and release operations

**Files:**

- Modify: `docs/firebase-setup.md`
- Modify: `docs/integration-testing.md`
- Modify: `docs/milestones.md`
- Modify: `functions/src/index.test.ts`
- Modify: `scripts/package-contract.test.mjs`

1. Add failing documentation contracts for daily-only delivery, no immediate
   notification, legacy shapes, no migration, Functions → Rules → frontend,
   non-invasive verification, monitoring, rollback, and no production email or
   follow.
2. Document that seller UID is identity, display name is presentation, follow
   time blocks replay, and contact data never enters subscriptions/events/email.
3. Mark Batch 7 repository-ready, not production-live. Run focused contracts and
   commit:

   ```sh
   git add docs/firebase-setup.md docs/integration-testing.md docs/milestones.md functions/src/index.test.ts scripts/package-contract.test.mjs
   git commit -m "docs: add seller subscription runbook"
   ```

## Task 12: Verify Batch 7 end to end

1. Use Node 22 and the intended local frontend environment only. Never source a
   production credential environment for Emulator tests.
2. Run:

   ```sh
   npm test
   npm run test:scripts
   npm run test:functions
   npm --prefix functions run lint
   npm run build:functions
   npm run test:rules
   npm run build:e2e
   npm run test:e2e:chromium
   npm run build
   git diff --check
   git status -sb
   ```

3. Scan all subscription writes, Listing-event fields, digest matching, Rules,
   and UI entry points. Confirm seller UID never comes from display text, contact
   data never crosses the boundary, old documents remain readable, and no
   browser can access operational notification state.
4. Map all ten design acceptance criteria to domain, converter, repository,
   Function, component, Rules, or E2E evidence. Add a failing regression test for
   any missing criterion and repeat RED → GREEN.
5. Record totals, warnings, commits, and explicitly state that no production
   deploy, follow, Listing, email, claim, import, or data mutation occurred
   before Batch 8.
