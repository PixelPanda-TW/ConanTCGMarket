# Character Subscription Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let authenticated buyers follow characters, receive a public Discord announcement for every new Listing, and optionally receive one personalized Gmail digest at 09:00 Asia/Taipei.

**Architecture:** The browser owns only its character subscription and daily-digest preference. Firestore-created Functions turn a new Listing into a durable server-only listing event, then publish it to one Discord webhook. A scheduled Function reads subscriptions and private delivery cursors to create idempotent Gmail digests without fan-out during Listing creation.

**Tech Stack:** React 19, TypeScript, Vite, Firebase Authentication, Cloud Firestore, Firebase Functions v2, Firestore Emulator, Vitest, Gmail API, Discord incoming webhooks.

**Spec:** `docs/superpowers/specs/2026-08-25-character-subscription-notifications-design.md`

## Global Constraints

- Subscription scope is one complete character, never rarity or card ID.
- Discord is a single public `#新上架通知` channel; do not add Discord OAuth, DMs, roles, or per-character channels.
- Never persist or publicly expose a Google email address in Firestore.
- Discord webhook URL and Gmail OAuth credentials are Firebase Secrets, never browser variables or committed files.
- New Listing creation must succeed even when Discord delivery fails.
- Run the digest every day at `09:00` with timezone `Asia/Taipei`.
- Function deployment requires Firebase Blaze plus a budget alert and Cloud Run Functions spend cap.
- Preserve existing untracked user documentation and `.codex/`; stage exact files only.

---

## File structure

| Path | Responsibility |
| --- | --- |
| `src/domain/characterKey.ts` | Normalize a display character name into one stable subscription key. |
| `src/domain/models/notificationSubscription.ts` | Browser-visible subscription model and validation. |
| `src/data/firestore/repositories/notificationSubscriptionRepository.ts` | Authenticated owner read/write API. |
| `src/features/notifications/NotificationSettingsPage.tsx` | Manage followed characters and email-digest toggle. |
| `src/features/notifications/CharacterSubscriptionControl.tsx` | Shared subscribe/unsubscribe control for Marketplace and Listing detail. |
| `functions/src/domain.ts` | Server-only Listing event, digest, and client interfaces. |
| `functions/src/listingEvents.ts` | Create and retry durable Listing events. |
| `functions/src/discordClient.ts` | Discord webhook request adapter. |
| `functions/src/gmailClient.ts` | Gmail API request adapter. |
| `functions/src/dailyDigest.ts` | Query, group, send, and advance private digest cursors. |
| `functions/src/index.ts` | Firebase Function v2 exports and secret bindings. |

## Task 1: Add normalized character subscriptions to the web domain

**Files:**
- Create: `src/domain/characterKey.ts`
- Create: `src/domain/characterKey.test.ts`
- Create: `src/domain/models/notificationSubscription.ts`
- Modify: `src/domain/models/index.ts`
- Test: `src/domain/models/domainModels.test.ts`

**Interfaces:**
- Produces `toCharacterKey(characterName: string): string`.
- Produces `NotificationSubscription` and `validateNotificationSubscription(value)`.

- [ ] **Step 1: Write the failing domain tests**

```ts
import { describe, expect, it } from 'vitest';
import { toCharacterKey } from './characterKey';

describe('toCharacterKey', () => {
  it('normalizes whitespace and Unicode without changing the character name', () => {
    expect(toCharacterKey('  諸伏　景光  ')).toBe('諸伏 景光');
  });

  it('rejects an empty character name', () => {
    expect(() => toCharacterKey('  ')).toThrow('Character name is required.');
  });
});
```

Add model tests that accept `{ uid: 'buyer-1', characterKeys: ['諸伏 景光'], emailDailyEnabled: true, updatedAt: new Date() }` and reject an empty key, duplicate key, or non-boolean preference.

- [ ] **Step 2: Run the focused tests to verify RED**

Run: `npm test -- src/domain/characterKey.test.ts src/domain/models/domainModels.test.ts`

Expected: FAIL because the key utility and subscription model do not exist.

- [ ] **Step 3: Implement the minimal domain API**

```ts
export function toCharacterKey(characterName: string): string {
  const key = characterName.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!key) throw new Error('Character name is required.');
  return key;
}

export interface NotificationSubscription {
  uid: string;
  characterKeys: string[];
  emailDailyEnabled: boolean;
  updatedAt: Date;
}
```

`validateNotificationSubscription` must require a non-empty UID, a valid Date, a boolean preference, and unique non-empty normalized keys. Re-export the model from `src/domain/models/index.ts`.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run: `npm test -- src/domain/characterKey.test.ts src/domain/models/domainModels.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/characterKey.ts src/domain/characterKey.test.ts src/domain/models/notificationSubscription.ts src/domain/models/domainModels.test.ts src/domain/models/index.ts
git commit -m "feat: add character subscription domain model"
```

## Task 2: Add the private Firestore subscription repository and rules

**Files:**
- Modify: `src/data/firestore/paths.ts`
- Modify: `src/data/firestore/converters.ts`
- Modify: `src/data/firestore/converters.test.ts`
- Create: `src/data/firestore/repositories/notificationSubscriptionRepository.ts`
- Create: `src/data/firestore/repositories/notificationSubscriptionRepository.test.ts`
- Modify: `src/data/firestore/repositories/index.ts`
- Modify: `firestore.rules`
- Modify: `src/rules/firebaseRules.test.ts`

**Interfaces:**
- Consumes `NotificationSubscription` from Task 1 and `auth.currentUser`.
- Produces `getNotificationSubscription(uid)`, `saveNotificationSubscription(subscription)`, and `deleteNotificationSubscription(uid)`.
- Produces Firestore collection constants `notificationSubscriptions`, `notificationDeliveryState`, and `listingEvents`.

- [ ] **Step 1: Write failing repository and Emulator rules tests**

```ts
it('writes only the authenticated buyer subscription document', async () => {
  auth.currentUser = { uid: 'buyer-1' } as never;
  await saveNotificationSubscription(subscriptionFor('buyer-1'));
  expect(firestore.setDoc).toHaveBeenCalled();
});

it('rejects another buyer reading or writing a subscription', async () => {
  const buyerA = environment.authenticatedContext('buyer-a').firestore();
  const buyerB = environment.authenticatedContext('buyer-b').firestore();
  await assertSucceeds(setDoc(doc(buyerA, 'notificationSubscriptions', 'buyer-a'), subscriptionData));
  await assertFails(getDoc(doc(buyerB, 'notificationSubscriptions', 'buyer-a')));
  await assertFails(setDoc(doc(buyerB, 'notificationSubscriptions', 'buyer-a'), subscriptionData));
});

it('rejects all browser reads and writes of notification events and delivery state', async () => {
  const buyer = environment.authenticatedContext('buyer-a').firestore();
  await assertFails(getDoc(doc(buyer, 'listingEvents', 'listing-1')));
  await assertFails(setDoc(doc(buyer, 'notificationDeliveryState', 'buyer-a'), {}));
});
```

- [ ] **Step 2: Run repository and rules tests to verify RED**

Run: `npm test -- src/data/firestore/repositories/notificationSubscriptionRepository.test.ts src/data/firestore/converters.test.ts`

Run: `npm run test:rules`

Expected: repository module is missing; Emulator rules permit/deny behavior is not implemented.

- [ ] **Step 3: Implement converter, repository, and rules**

Use document ID `uid` and the existing `withConverter` repository style. Reject owner mismatches before Firestore calls:

```ts
function assertOwner(uid: string) {
  if (auth.currentUser?.uid !== uid) {
    throw new Error('Notification subscription access requires the authenticated buyer.');
  }
}
```

Add rules:

```firestore
match /notificationSubscriptions/{uid} {
  allow read, create, update, delete: if request.auth != null && request.auth.uid == uid;
}
match /notificationDeliveryState/{id} { allow read, write: if false; }
match /listingEvents/{id} { allow read, write: if false; }
```

The converter serializes `updatedAt` as `Timestamp`; no email field is accepted.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run: `npm test -- src/data/firestore/repositories/notificationSubscriptionRepository.test.ts src/data/firestore/converters.test.ts`

Run: `npm run test:rules`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/firestore/paths.ts src/data/firestore/converters.ts src/data/firestore/converters.test.ts src/data/firestore/repositories/notificationSubscriptionRepository.ts src/data/firestore/repositories/notificationSubscriptionRepository.test.ts src/data/firestore/repositories/index.ts firestore.rules src/rules/firebaseRules.test.ts
git commit -m "feat: store private character subscriptions"
```

## Task 3: Add notification settings routing and subscription controls

**Files:**
- Create: `src/features/notifications/CharacterSubscriptionControl.tsx`
- Create: `src/features/notifications/CharacterSubscriptionControl.test.tsx`
- Create: `src/features/notifications/NotificationSettingsPage.tsx`
- Create: `src/features/notifications/NotificationSettingsPage.test.tsx`
- Modify: `src/features/marketplace/MarketplacePage.tsx`
- Modify: `src/features/marketplace/MarketplacePage.test.tsx`
- Modify: `src/features/listings/ListingPage.tsx`
- Create: `src/features/listings/ListingPage.test.tsx`
- Modify: `src/features/auth/AuthStatus.tsx`
- Modify: `src/route.ts`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes `getNotificationSubscription`, `saveNotificationSubscription`, `toCharacterKey`, `useAuth`, and selected/loaded Cards.
- Produces `CharacterSubscriptionControl({ characterName, isKnownCharacter })` and `NotificationSettingsPage` at `#/notifications`.

- [ ] **Step 1: Write failing UI and route tests**

```tsx
it('shows subscribe only for a known selected character and persists it for a signed-in buyer', async () => {
  render(<CharacterSubscriptionControl characterName="諸伏景光" isKnownCharacter />);
  await user.click(screen.getByRole('button', { name: '訂閱諸伏景光' }));
  expect(saveSubscription).toHaveBeenCalledWith(expect.objectContaining({
    characterKeys: ['諸伏景光'],
  }));
});

it('sends an unauthenticated buyer to Google sign-in guidance', async () => {
  render(<CharacterSubscriptionControl characterName="諸伏景光" isKnownCharacter />);
  await user.click(screen.getByRole('button', { name: '訂閱諸伏景光' }));
  expect(screen.getByText('登入後即可訂閱角色通知')).toBeTruthy();
});

it('renders notification settings for #/notifications', () => {
  window.location.hash = '#/notifications';
  render(<App />);
  expect(screen.getByRole('heading', { name: '通知設定' })).toBeTruthy();
});
```

Settings tests must remove a character, toggle `emailDailyEnabled`, show the public Discord explanation, and show a loading/error state. Marketplace test must prove an invalid free-text character shows no subscription control.

- [ ] **Step 2: Run focused UI tests to verify RED**

Run: `npm test -- src/features/notifications/CharacterSubscriptionControl.test.tsx src/features/notifications/NotificationSettingsPage.test.tsx src/features/marketplace/MarketplacePage.test.tsx src/App.test.tsx`

Expected: FAIL because the controls, route, and settings page do not exist.

- [ ] **Step 3: Implement minimal accessible UI**

Add `notifications` to `AppRoute`, render the settings page in `App`, and add a “通知設定” link for authenticated users in `AuthStatus`. The shared control must use a `<button>` with the exact labels `訂閱{characterName}` and `取消訂閱{characterName}`, `aria-live="polite"` for save errors, and must validate `isKnownCharacter` before enabling interaction.

Place the Marketplace control beside the existing metadata filter only when `cards.some((card) => card.characterName === filters.characterName)`. Place the Listing detail control after the Listing character heading, using the loaded Listing snapshot name. Reuse existing form, button, focus-ring, page-shell, and responsive styles; do not add a new visual system.

- [ ] **Step 4: Run focused UI tests to verify GREEN**

Run: `npm test -- src/features/notifications/CharacterSubscriptionControl.test.tsx src/features/notifications/NotificationSettingsPage.test.tsx src/features/marketplace/MarketplacePage.test.tsx src/features/listings/ListingPage.test.tsx src/App.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/notifications src/features/marketplace/MarketplacePage.tsx src/features/marketplace/MarketplacePage.test.tsx src/features/listings/ListingPage.tsx src/features/listings/ListingPage.test.tsx src/features/auth/AuthStatus.tsx src/route.ts src/App.tsx src/App.test.tsx src/styles.css
git commit -m "feat: add buyer notification settings"
```

## Task 4: Scaffold a separately tested Firebase Functions codebase

**Files:**
- Create: `functions/package.json`
- Create: `functions/tsconfig.json`
- Create: `functions/vitest.config.ts`
- Create: `functions/src/domain.ts`
- Create: `functions/src/domain.test.ts`
- Modify: `firebase.json`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Produces Function package scripts `build`, `test`, and `lint` (TypeScript `--noEmit`).
- Produces `ListingEvent`, `DiscordClient`, `GmailClient`, and `RecipientDirectory` server interfaces.

- [ ] **Step 1: Write failing Function domain tests**

```ts
it('creates an event snapshot from a complete active listing', () => {
  expect(toListingEvent('listing-1', listing)).toMatchObject({
    id: 'listing-1',
    characterKey: '諸伏景光',
    discordStatus: 'pending',
    attempts: 0,
  });
});

it('rejects a listing without character metadata', () => {
  expect(() => toListingEvent('listing-1', { ...listing, characterName: undefined }))
    .toThrow('Listing event requires character metadata.');
});
```

- [ ] **Step 2: Run Function test to verify RED**

Run: `npm --prefix functions test -- src/domain.test.ts`

Expected: FAIL because the Functions package and domain API do not exist.

- [ ] **Step 3: Create the Function package and domain contracts**

Use Node 20, TypeScript, `firebase-admin`, `firebase-functions`, `googleapis`, and Vitest. Configure `firebase.json` with a `functions` source named `functions`. Add root scripts:

```json
{
  "test:functions": "npm --prefix functions test",
  "build:functions": "npm --prefix functions run build"
}
```

Define the event and adapters:

```ts
export interface DiscordClient { publishNewListing(event: ListingEvent): Promise<void>; }
export interface GmailClient { sendDigest(message: DigestEmail): Promise<void>; }
export interface RecipientDirectory { getVerifiedEmail(uid: string): Promise<string | null>; }
```

`ListingEvent` must contain only the snapshot fields approved in the spec plus status, attempts, and retry timing; it must not contain seller contacts or email addresses.

- [ ] **Step 4: Run Function build and tests to verify GREEN**

Run: `npm --prefix functions test -- src/domain.test.ts && npm --prefix functions run build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/package.json functions/tsconfig.json functions/vitest.config.ts functions/src/domain.ts functions/src/domain.test.ts firebase.json package.json .gitignore
git commit -m "build: add notification Functions codebase"
```

## Task 5: Capture Listing events and deliver Discord announcements

**Files:**
- Create: `functions/src/listingEvents.ts`
- Create: `functions/src/listingEvents.test.ts`
- Create: `functions/src/discordClient.ts`
- Create: `functions/src/discordClient.test.ts`
- Create: `functions/src/index.ts`
- Modify: `functions/package.json`

**Interfaces:**
- Consumes `toListingEvent`, `ListingEvent`, and `DiscordClient` from Task 4.
- Produces `captureListingEvent`, `deliverDiscordEvent`, and `retryFailedDiscordEvents` Function handlers.

- [ ] **Step 1: Write failing event and Discord client tests**

```ts
it('creates one pending event from duplicate Listing-created deliveries', async () => {
  await captureListingEvent({ params: { listingId: 'listing-1' }, data: listingSnapshot }, deps);
  await captureListingEvent({ params: { listingId: 'listing-1' }, data: listingSnapshot }, deps);
  expect(deps.events.create).toHaveBeenCalledTimes(1);
});

it('posts the approved public Discord payload and marks it sent', async () => {
  await deliverDiscordEvent(event, deps);
  expect(discord.publishNewListing).toHaveBeenCalledWith(event);
  expect(deps.events.markSent).toHaveBeenCalledWith('listing-1', expect.any(Date));
});

it('marks a Discord failure without changing the Listing', async () => {
  discord.publishNewListing.mockRejectedValue(new Error('Discord unavailable'));
  await deliverDiscordEvent(event, deps);
  expect(deps.events.markFailed).toHaveBeenCalledWith('listing-1', 1, expect.any(Date));
  expect(deps.listings.update).not.toHaveBeenCalled();
});
```

Discord client tests must assert the request is `POST`, content contains character, rarity, card ID, price, remaining quantity, and the `/ConanTCGMarket/#/listing/{id}` URL, and no seller ID/contact field.

- [ ] **Step 2: Run Function tests to verify RED**

Run: `npm --prefix functions test -- src/listingEvents.test.ts src/discordClient.test.ts`

Expected: FAIL because the handlers and client are absent.

- [ ] **Step 3: Implement durable event capture and bounded delivery**

`captureListingEvent` uses Firestore `create()` on `listingEvents/{listingId}` and ignores the already-exists error. Export it through `onDocumentCreated('listings/{listingId}', ...)`.

`deliverDiscordEvent` sends only `pending` events and stores `sent` with a timestamp after success. On transient failure increment `attempts`, set `failed`, and compute `nextAttemptAt` with exponential backoff capped at three attempts. `retryFailedDiscordEvents` is an `onSchedule('every 15 minutes')` handler that queries due failed events with `attempts < 3`; it never changes a Listing.

`discordClient.ts` reads `DISCORD_LISTINGS_WEBHOOK_URL` from a Function Secret and throws for a non-2xx response without including the secret in the error.

- [ ] **Step 4: Run Function tests and build to verify GREEN**

Run: `npm --prefix functions test -- src/listingEvents.test.ts src/discordClient.test.ts && npm --prefix functions run build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/listingEvents.ts functions/src/listingEvents.test.ts functions/src/discordClient.ts functions/src/discordClient.test.ts functions/src/index.ts functions/package.json
git commit -m "feat: announce new listings to Discord"
```

## Task 6: Build idempotent daily Gmail digests

**Files:**
- Create: `functions/src/dailyDigest.ts`
- Create: `functions/src/dailyDigest.test.ts`
- Create: `functions/src/gmailClient.ts`
- Create: `functions/src/gmailClient.test.ts`
- Modify: `functions/src/index.ts`
- Modify: `functions/package.json`

**Interfaces:**
- Consumes `GmailClient`, `RecipientDirectory`, `ListingEvent`, and `NotificationSubscription` contracts from Tasks 1 and 4.
- Produces `runDailyDigest(now, deps)` and `sendGmailDigest(message)`.

- [ ] **Step 1: Write failing digest and Gmail client tests**

```ts
it('groups only new events for subscribed characters into one email', async () => {
  await runDailyDigest(new Date('2026-08-26T01:00:00.000Z'), deps);
  expect(gmail.sendDigest).toHaveBeenCalledWith(expect.objectContaining({
    to: 'buyer@example.com',
    subject: '柯南 TCG 新上架摘要',
    groups: [{ characterName: '諸伏景光', listings: [expect.objectContaining({ id: 'listing-1' })] }],
  }));
});

it('does not advance the cursor when Gmail send fails', async () => {
  gmail.sendDigest.mockRejectedValue(new Error('mail unavailable'));
  await runDailyDigest(now, deps);
  expect(deps.deliveryState.advance).not.toHaveBeenCalled();
});

it('skips an unverified or missing Google email without exposing it', async () => {
  recipients.getVerifiedEmail.mockResolvedValue(null);
  await runDailyDigest(now, deps);
  expect(gmail.sendDigest).not.toHaveBeenCalled();
});
```

Also test 30-character query chunking, daily recipient-cap deferral, empty result behavior, duplicate completed-run behavior, the 09:00 Asia/Taipei scheduler declaration, and a Gmail API request built from the dedicated sender without a recipient address in Firestore.

- [ ] **Step 2: Run Function digest tests to verify RED**

Run: `npm --prefix functions test -- src/dailyDigest.test.ts src/gmailClient.test.ts`

Expected: FAIL because the daily digest and Gmail adapter do not exist.

- [ ] **Step 3: Implement grouping, cursoring, and Gmail adapter**

Use a `RecipientDirectory` backed by `getAuth().getUser(uid)` and return an email only when `emailVerified` and `email` are both present. Query only `emailDailyEnabled == true` subscriptions. For each subscriber, use the private cursor (or epoch for a first run), query events in character-key chunks of at most 30, deduplicate by Listing ID, then sort by event creation time.

Build a plain-text and HTML email with character headings, price, rarity, card ID, remaining quantity, direct Listing links, and a `#/notifications` settings link. Do not use image URLs. Advance a cursor only after `GmailClient.sendDigest` succeeds. Limit one invocation to the configured conservative recipient cap and leave deferred cursors unchanged.

Use Gmail API OAuth client ID, secret, refresh token, and sender address from Firebase Secrets. Ensure logs include only UID/event IDs and never access tokens, refresh tokens, webhook URLs, or recipient email addresses.

- [ ] **Step 4: Run Function digest tests and build to verify GREEN**

Run: `npm --prefix functions test -- src/dailyDigest.test.ts src/gmailClient.test.ts && npm --prefix functions run build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/dailyDigest.ts functions/src/dailyDigest.test.ts functions/src/gmailClient.ts functions/src/gmailClient.test.ts functions/src/index.ts functions/package.json
git commit -m "feat: send daily character listing digests"
```

## Task 7: Complete deployment safeguards and end-to-end verification

**Files:**
- Modify: `docs/firebase-setup.md`
- Create: `functions/src/index.test.ts`

**Interfaces:**
- Consumes all web, rules, and Functions artifacts from Tasks 1-6.
- Produces documented secret names, deployment commands, and a repeatable test command sequence.

- [ ] **Step 1: Write failing configuration/documentation assertions**

Create `functions/src/index.test.ts` that imports Function exports and asserts the expected names `captureListingEvent`, `deliverDiscordEvent`, `retryFailedDiscordEvents`, and `sendDailyDigest` exist. Add a text assertion test reading `docs/firebase-setup.md` that requires `DISCORD_LISTINGS_WEBHOOK_URL`, Gmail OAuth secret names, Blaze, `Asia/Taipei`, and a budget/spend-cap instruction.

- [ ] **Step 2: Run final focused checks to verify RED**

Run: `npm --prefix functions test -- src/index.test.ts`

Run: `npm test -- src/rules/firebaseRules.test.ts`

Expected: documentation/configuration assertions fail until the deployment material is updated; all existing rules remain green before any final edits.

- [ ] **Step 3: Add exact deployment safeguards**

Document these Firebase Secrets exactly:

```text
DISCORD_LISTINGS_WEBHOOK_URL
GMAIL_OAUTH_CLIENT_ID
GMAIL_OAUTH_CLIENT_SECRET
GMAIL_OAUTH_REFRESH_TOKEN
GMAIL_SENDER_ADDRESS
```

Document `firebase functions:secrets:set <NAME>` for each, `firebase deploy --only functions,firestore`, the required Blaze upgrade, budget alert, Cloud Run Functions spend cap, and a test checklist using a non-production Listing plus one test subscriber. The existing GitHub Pages workflow remains web-only; run `npm test`, `npm run build`, `npm run test:rules`, `npm run test:functions`, and `npm run build:functions` before a separate Firebase deployment.

- [ ] **Step 4: Run complete verification to verify GREEN**

Run: `zsh -lc 'set -a; source .env; set +a; npm test && npm run build && npm run test:rules && npm run test:functions && npm run build:functions'`

Expected: all web, Emulator, and Function tests pass; both builds complete. Confirm `git diff --check` is empty and `git status --short` contains only intentional feature files plus pre-existing untracked user files.

- [ ] **Step 5: Commit**

```bash
git add docs/firebase-setup.md functions/src/index.test.ts
git commit -m "docs: document notification deployment safeguards"
```

Only stage files that exist and changed; never stage `.codex/` or pre-existing untracked documents.
