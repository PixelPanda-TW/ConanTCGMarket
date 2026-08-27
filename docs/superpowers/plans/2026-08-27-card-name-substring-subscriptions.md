# Card Name Substring Subscriptions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace character-only subscriptions with complete Card Master name subscriptions that match new Listings by raw substring across every card type, ID, and rarity, then deliver deduplicated daily Gmail summaries.

**Architecture:** Store up to 100 exact Card Master names in each buyer's existing subscription document. Capture every valid Listing as one generic, idempotent event, then read each sequence window once per subscriber page and perform case-sensitive `includes` matching in Functions memory while preserving the current per-recipient claim and recovery protocol. Reuse the existing Marketplace, Listing detail, and `#/notifications` surfaces through one generic subscription control.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Firebase Auth, Firestore, Firestore Rules Emulator, Cloud Functions for Firebase Gen 2, Gmail OAuth, Node.js 22.

**Spec:** `docs/superpowers/specs/2026-08-27-card-name-substring-subscriptions-design.md`

## Global Constraints

- A subscription value must be a complete current Card Master `cardName`; arbitrary typed keywords are not saved.
- Matching is raw, case-sensitive `listingEvent.cardName.includes(subscribedCardName)` after trimming only the subscription's outer whitespace.
- Matching ignores `cardType`, `cardId`, rarity, printing, and card face.
- Store at most 100 unique names, each 1 to 100 characters; an empty list is valid.
- One Listing appears at most once per buyer digest even when multiple names match it.
- A buyer with no new matches receives no email.
- Gmail always targets the verified Google sign-in address; never add a custom recipient field.
- Discord remains disabled and no Discord Function or secret is reintroduced.
- Do not store official images, effects, traits, or unapproved source fields in notification documents.
- Existing `characterKeys` documents are test-only; reject or ignore them rather than adding migration compatibility.
- Upgrade Functions from Node.js 20 to Node.js 22.
- Preserve the existing reservation, `sending` ambiguity, operator recovery, recipient cap, and retry semantics.
- Use the existing glassmorphic design tokens and 44px minimum interactive target; before UI tasks, read and follow `.codex/skills/ui-ux-pro-max/SKILL.md`.
- Do not delete production data, send a production test email, merge, push, or deploy without a separate explicit approval at release handoff.

## File Structure

### Frontend domain and persistence

- Modify `src/domain/models/notificationSubscription.ts`: define and validate the `cardNames` contract.
- Modify `src/domain/models/domainModels.test.ts`: cover valid, empty, raw, duplicate, excessive, and malformed names.
- Create `src/domain/cardNameSubscription.ts`: pure known-name and coverage helpers for all UI surfaces.
- Create `src/domain/cardNameSubscription.test.ts`: prove exact Card Master selection and raw substring coverage.
- Modify `src/data/firestore/converters.ts`: serialize only `cardNames`, `emailDailyEnabled`, and `updatedAt`.
- Modify `src/data/firestore/converters.test.ts`: verify the new Firestore shape and old-shape rejection.
- Modify `src/data/firestore/repositories/notificationSubscriptionRepository.test.ts`: update repository fixtures and owner checks.

### Cloud Functions domain and orchestration

- Modify `functions/src/domain.ts`: make Listing events generic and digest groups card-name based.
- Modify `functions/src/domain.test.ts`: validate all four card types and raw card names.
- Modify `functions/src/listingEvents.ts`: capture every valid Listing without character-only routing.
- Modify `functions/src/listingEvents.test.ts`: prove all-type capture and retry idempotency.
- Modify `functions/src/discordClient.ts`: keep the non-exported legacy client compiling against generic event fields without enabling it.
- Modify `functions/src/discordClient.test.ts`: update generic copy expectations only.
- Create `functions/src/cardNameSubscriptions.ts`: strict server-side subscription validation and raw matching.
- Create `functions/src/cardNameSubscriptions.test.ts`: unit-test validation, non-normalization, substring matching, and deduplication inputs.
- Modify `functions/src/dailyDigest.ts`: page one event window per subscriber page and filter matches in memory.
- Modify `functions/src/dailyDigest.test.ts`: test generic grouping, substring behavior, shared reads, failures, and delivery state.
- Modify `functions/src/index.ts`: adapt Firestore reads/writes to `cardNames`, generic events, and sequence pagination.
- Modify `functions/src/index.test.ts`: preserve the three-function email-only manifest and assert Node.js 22 configuration.
- Modify `functions/src/config.test.ts`: remove the obsolete character-query index contract.
- Modify `functions/package.json`: set `engines.node` to `22`.
- Modify `firestore.indexes.json`: remove the obsolete `characterKey + capturedSequence` composite index; keep unrelated retained indexes unchanged.

### Rules and UI

- Modify `firestore.rules`: authorize only the owner and the new subscription shape.
- Modify `src/rules/firebaseRules.test.ts`: cover new valid and invalid shapes with the Emulator.
- Create `src/features/notifications/CardNameSubscriptionControl.tsx`: generic subscribe, unsubscribe, confirmation, sign-in, covered-name, and error states.
- Create `src/features/notifications/CardNameSubscriptionControl.test.tsx`: component contract for every state.
- Delete `src/features/notifications/CharacterSubscriptionControl.tsx`.
- Delete `src/features/notifications/CharacterSubscriptionControl.test.tsx`.
- Modify `src/features/marketplace/MarketplacePage.tsx`: show the generic control for a complete Card Master name without requiring ID or rarity.
- Modify `src/features/marketplace/MarketplacePage.test.tsx`: cover Event, Case, Partner, and incomplete names.
- Modify `src/features/listings/ListingPage.tsx`: show exact or covered-name subscription state for resolved metadata.
- Modify `src/features/listings/ListingPage.test.tsx`: cover generic, covered, and ambiguous metadata.
- Modify `src/features/notifications/NotificationSettingsPage.tsx`: turn the existing route into `我的訂閱` with sorted card names and per-name removal.
- Modify `src/features/notifications/NotificationSettingsPage.test.tsx`: update management behavior and concurrency tests.
- Modify `src/features/auth/AuthStatus.tsx`: rename the navigation entry to `我的訂閱`.
- Modify `src/features/auth/AuthStatus.test.tsx`: assert the new label and route.
- Modify `src/App.test.tsx`: assert the existing `#/notifications` route renders the new page heading.
- Modify `src/styles.css`: rename character-only classes and style covered, empty, mobile, focus, and saving states with the existing tokens.

### Operations documentation

- Modify `docs/firebase-setup.md`: document generic card-name subscriptions, Node.js 22, no-match behavior, deployment order, and non-production verification.

---

### Task 1: Frontend Card-Name Subscription Contract

**Files:**
- Create: `src/domain/cardNameSubscription.ts`
- Create: `src/domain/cardNameSubscription.test.ts`
- Modify: `src/domain/models/notificationSubscription.ts`
- Modify: `src/domain/models/domainModels.test.ts`
- Modify: `src/data/firestore/converters.ts`
- Modify: `src/data/firestore/converters.test.ts`
- Modify: `src/data/firestore/repositories/notificationSubscriptionRepository.test.ts`

**Interfaces:**
- Consumes: existing `Card` model fields `cardName`, `cardType`, and `cardId`.
- Produces: `NotificationSubscription.cardNames: string[]`, `isKnownSubscriptionCardName(cards, value): boolean`, and `findCoveringSubscription(cardNames, targetCardName): string | undefined` for Tasks 6 and 7.

- [ ] **Step 1: Write failing domain tests for the new shape**

Replace character-key fixtures in `src/domain/models/domainModels.test.ts` and add explicit raw-string cases:

```ts
const subscription: NotificationSubscription = {
  uid: 'buyer-1',
  cardNames: ['江戶川柯南', '洗牌情緣'],
  emailDailyEnabled: true,
  updatedAt: new Date('2026-08-27T00:00:00.000Z'),
};

expect(() => validateNotificationSubscription(subscription)).not.toThrow();
expect(() => validateNotificationSubscription({
  ...subscription,
  cardNames: [],
})).not.toThrow();
expect(() => validateNotificationSubscription({
  ...subscription,
  cardNames: ['江戶川柯南', '江戶川柯南'],
})).toThrow('unique card names');
expect(() => validateNotificationSubscription({
  ...subscription,
  cardNames: [' 江戶川柯南'],
})).toThrow('trimmed card names');
```

Also reject a non-string entry, an empty string, a 101-character name, 101 names, missing `cardNames`, and legacy-only `characterKeys`.

- [ ] **Step 2: Write failing pure-helper tests**

Create `src/domain/cardNameSubscription.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  findCoveringSubscription,
  isKnownSubscriptionCardName,
} from './cardNameSubscription';

const cards = [
  { key: 'character_1', cardId: '0001', cardType: 'character' as const, cardName: '江戶川柯南', rarities: ['SR'] },
  { key: 'event_1', cardId: '0019', cardType: 'case' as const, cardName: '洗牌情緣', rarities: ['C', 'CP'] },
];

it('requires a complete raw Card Master name', () => {
  expect(isKnownSubscriptionCardName(cards, '江戶川柯南')).toBe(true);
  expect(isKnownSubscriptionCardName(cards, '柯南')).toBe(false);
  expect(isKnownSubscriptionCardName(cards, ' 江戶川柯南')).toBe(false);
});

it('chooses the longest deterministic covering subscription', () => {
  expect(findCoveringSubscription(
    ['柯南', '江戶川柯南'],
    '江戶川柯南＆灰原哀',
  )).toBe('江戶川柯南');
  expect(findCoveringSubscription(['江戶川柯南'], '江戶川コナン')).toBeUndefined();
});
```

- [ ] **Step 3: Write failing converter and repository expectations**

In `src/data/firestore/converters.test.ts`, expect the converter to write exactly:

```ts
{
  cardNames: ['江戶川柯南', '洗牌情緣'],
  emailDailyEnabled: true,
  updatedAt: expect.any(Timestamp),
}
```

Expect `fromFirestore` to construct `uid` from `snapshot.id` and reject a document containing only `characterKeys`. Update repository fixtures to `cardNames` while preserving the current authenticated-owner assertions.

- [ ] **Step 4: Run focused tests to verify they fail**

Run:

```bash
npm test -- src/domain/models/domainModels.test.ts src/domain/cardNameSubscription.test.ts src/data/firestore/converters.test.ts src/data/firestore/repositories/notificationSubscriptionRepository.test.ts
```

Expected: FAIL because `cardNames` and the two helpers do not exist and the converter still writes `characterKeys`.

- [ ] **Step 5: Implement the new model and helpers**

Replace the frontend interface and validator with:

```ts
const MAX_NOTIFICATION_CARD_NAMES = 100;
const MAX_NOTIFICATION_CARD_NAME_LENGTH = 100;

export interface NotificationSubscription {
  uid: string;
  cardNames: string[];
  emailDailyEnabled: boolean;
  updatedAt: Date;
}
```

Validate every value as a non-empty string equal to its own `.trim()`, with a maximum length of 100, and reject duplicate raw strings. Do not call `normalize`, `toLocaleLowerCase`, or `toCharacterKey`.

Create the pure helpers:

```ts
import type { Card } from './models';

export function isKnownSubscriptionCardName(cards: readonly Card[], value: string): boolean {
  return cards.some((card) => card.cardName === value);
}

export function findCoveringSubscription(
  cardNames: readonly string[],
  targetCardName: string,
): string | undefined {
  return [...cardNames]
    .filter((cardName) => targetCardName.includes(cardName))
    .sort((left, right) => right.length - left.length || left.localeCompare(right, 'zh-Hant'))[0];
}
```

Update the converter to read and write `cardNames` only. Keep repository implementation unchanged because the converter owns the shape.

- [ ] **Step 6: Run focused tests to verify they pass**

Run the Step 4 command again.

Expected: all listed files PASS with zero failures.

- [ ] **Step 7: Commit the domain and persistence contract**

```bash
git add src/domain/models/notificationSubscription.ts src/domain/models/domainModels.test.ts src/domain/cardNameSubscription.ts src/domain/cardNameSubscription.test.ts src/data/firestore/converters.ts src/data/firestore/converters.test.ts src/data/firestore/repositories/notificationSubscriptionRepository.test.ts
git commit -m "refactor: model notifications by card name"
```

---

### Task 2: Generic Listing Event Capture

**Files:**
- Modify: `functions/src/domain.ts`
- Modify: `functions/src/domain.test.ts`
- Modify: `functions/src/listingEvents.ts`
- Modify: `functions/src/listingEvents.test.ts`
- Modify: `functions/src/discordClient.ts`
- Modify: `functions/src/discordClient.test.ts`

**Interfaces:**
- Consumes: Firestore Listing snapshots with `cardType`, `cardName`, `cardId`, `rarity`, price, quantity, status, and timestamps.
- Produces: generic `ListingEvent`, `ListingEventDraft`, `DigestGroup.cardName`, `toListingEvent(listingId, listing, options)`, and `captureListingEvent(source, deps, options)` for Tasks 3 and 4.

- [ ] **Step 1: Write failing generic event-domain tests**

In `functions/src/domain.test.ts`, table-test all four types:

```ts
it.each([
  ['character', '江戶川柯南', '0001'],
  ['partner', '江戶川柯南', 'P001'],
  ['event', '追蹤開始', '1100'],
  ['case', '洗牌情緣', '0019'],
] as const)('creates a generic %s event', (cardType, cardName, cardId) => {
  expect(toListingEvent('listing-1', {
    cardType,
    cardName,
    cardId,
    rarity: 'CP',
    listingPrice: 500,
    remainingQuantity: 2,
    status: 'active',
    createdAt: new Date('2026-08-27T00:00:00.000Z'),
  }, { discordEnabled: false })).toMatchObject({
    listingId: 'listing-1',
    cardType,
    cardName,
    cardId,
    rarity: 'CP',
    discordStatus: 'disabled',
  });
});
```

Reject missing or unknown `cardType`, missing `cardName`, non-active status, malformed IDs, rarity, price, quantity, and dates. Assert no character-specific field is required for Partner, Event, or Case.

- [ ] **Step 2: Write failing capture tests for all card types and duplicates**

Replace the test that expects non-character Listings to be ignored with a table that expects `events.create` once for each valid type. Preserve the duplicate-delivery test and assert the fixed event ID remains the Listing ID:

```ts
expect(createdEvent).toMatchObject({
  id: 'event-listing',
  listingId: 'event-listing',
  cardType: 'event',
  cardName: '追蹤開始',
  cardId: '1100',
});
```

- [ ] **Step 3: Run capture tests to verify they fail**

Run:

```bash
npm --prefix functions test -- src/domain.test.ts src/listingEvents.test.ts src/discordClient.test.ts
```

Expected: FAIL because non-character cards are currently ignored and event fields remain character-specific.

- [ ] **Step 4: Implement the generic event shape and capture path**

Change `ListingEvent` and its draft to use:

```ts
cardType: 'character' | 'event' | 'case' | 'partner';
cardName: string;
cardId: string;
rarity: string;
```

Remove `characterKey` and `characterName` from the current event contract. Make `toListingEvent` require one of the four types and return the generic fields. Remove `toCharacterListingEvent`; `captureListingEvent` must always call `toListingEvent` and must keep its current `already-exists` handling.

Keep Discord disabled. Update the retained non-exported Discord formatter to compile with generic fields by rendering `卡名：${event.cardName}` instead of a character label; do not add a Function export, secret, schedule, or delivery call.

- [ ] **Step 5: Run capture tests to verify they pass**

Run the Step 3 command again.

Expected: all three test files PASS.

- [ ] **Step 6: Commit generic event capture**

```bash
git add functions/src/domain.ts functions/src/domain.test.ts functions/src/listingEvents.ts functions/src/listingEvents.test.ts functions/src/discordClient.ts functions/src/discordClient.test.ts
git commit -m "feat: capture notifications for every card type"
```

---

### Task 3: Batched Raw-Substring Daily Digest

**Files:**
- Create: `functions/src/cardNameSubscriptions.ts`
- Create: `functions/src/cardNameSubscriptions.test.ts`
- Modify: `functions/src/dailyDigest.ts`
- Modify: `functions/src/dailyDigest.test.ts`

**Interfaces:**
- Consumes: Task 2 `ListingEvent` values and `NotificationSubscription.cardNames` documents.
- Produces: `readSubscriptionCardNames(value): string[] | null`, `matchesSubscribedCardName(cardNames, listingName): boolean`, and `DailyDigestEventStore.findNewInSequenceRange(afterSequence, throughSequence, limit): Promise<ListingEvent[]>` for Task 4.

- [ ] **Step 1: Write failing strict-validation and raw-match tests**

Create `functions/src/cardNameSubscriptions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  matchesSubscribedCardName,
  readSubscriptionCardNames,
} from './cardNameSubscriptions.js';

it('accepts unique trimmed complete names and an empty list', () => {
  expect(readSubscriptionCardNames(['江戶川柯南', '洗牌情緣'])).toEqual(['江戶川柯南', '洗牌情緣']);
  expect(readSubscriptionCardNames([])).toEqual([]);
});

it('rejects malformed subscription lists', () => {
  expect(readSubscriptionCardNames([' 江戶川柯南'])).toBeNull();
  expect(readSubscriptionCardNames(['江戶川柯南', '江戶川柯南'])).toBeNull();
  expect(readSubscriptionCardNames(Array.from({ length: 101 }, (_, index) => `卡名-${index}`))).toBeNull();
});

it('uses raw case-sensitive substring matching without normalization', () => {
  expect(matchesSubscribedCardName(['江戶川柯南'], '江戶川柯南＆灰原哀')).toBe(true);
  expect(matchesSubscribedCardName(['江戶川柯南'], '江戶川コナン')).toBe(false);
  expect(matchesSubscribedCardName(['CONAN'], 'Conan')).toBe(false);
});
```

- [ ] **Step 2: Rewrite digest test dependencies around one paged range reader**

In `functions/src/dailyDigest.test.ts`, replace `findNewByCharacterKeys` with a spy matching this contract:

```ts
findNewInSequenceRange: vi.fn(async (afterSequence, throughSequence, limit) => events
  .filter((event) => event.capturedSequence > afterSequence
    && event.capturedSequence <= throughSequence)
  .sort((left, right) => left.capturedSequence - right.capturedSequence)
  .slice(0, limit)),
```

Use generic subscriptions such as:

```ts
{
  uid: 'buyer-1',
  cardNames: ['江戶川柯南'],
  emailDailyEnabled: true,
  updatedAt: new Date('2026-08-27T00:00:00.000Z'),
}
```

- [ ] **Step 3: Add failing orchestration tests**

Add tests that prove:

1. Character and Partner events with different IDs and rarities both match `江戶川柯南`.
2. `江戶川柯南＆灰原哀` matches `江戶川柯南`.
3. Unicode-, case-, punctuation-, or width-different names do not match unless raw `includes` returns true.
4. `['柯南', '江戶川柯南']` produces one Listing row.
5. Two subscribers in one page cause one sequence-window read per event page, not two per-user reads.
6. More than 250 events cause deterministic pagination without duplicates.
7. An event-page read failure calls `deliveryState.release(uid, claimId)` for every still-reserved claim before rethrowing.
8. No matches call `completeWithoutSend` and do not call Gmail.
9. Existing `reserved`, `sending`, run-date, cursor, recipient-cap, and operator recovery tests continue to pass.

- [ ] **Step 4: Run digest tests to verify they fail**

Run:

```bash
npm --prefix functions test -- src/cardNameSubscriptions.test.ts src/dailyDigest.test.ts src/dailyDigestOperator.test.ts src/gmailClient.test.ts
```

Expected: FAIL because the validator, range reader, generic groups, and page-shared orchestration do not exist.

- [ ] **Step 5: Implement strict server validation and matching**

Create `functions/src/cardNameSubscriptions.ts` with exact limits:

```ts
const MAX_CARD_NAMES = 100;
const MAX_CARD_NAME_LENGTH = 100;

export function readSubscriptionCardNames(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_CARD_NAMES) return null;
  const names = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string'
      || item.length === 0
      || item.length > MAX_CARD_NAME_LENGTH
      || item !== item.trim()
      || names.has(item)) return null;
    names.add(item);
  }
  return [...names];
}

export function matchesSubscribedCardName(
  cardNames: readonly string[],
  listingName: string,
): boolean {
  return cardNames.some((cardName) => listingName.includes(cardName));
}
```

- [ ] **Step 6: Implement one event-window scan per subscriber page**

Set `DAILY_EVENT_PAGE_SIZE = 250`. Change the event-store interface to:

```ts
export interface NotificationSubscription {
  uid: string;
  cardNames: string[];
  emailDailyEnabled: boolean;
  updatedAt: Date;
}

findNewInSequenceRange(
  afterSequence: number,
  throughSequence: number,
  limit: number,
): Promise<ListingEvent[]>;
```

For each subscription page, validate and claim eligible recipients first. Find the smallest claimed `afterSequence`, page events up to the shared run window, and route each event only to claims whose individual range contains it. Use `Map<string, ListingEvent>` per UID for deduplication. On a page-read exception, release every claim that has not entered `sending`, then rethrow.

Change digest groups from `characterName` to actual `cardName`. Render type, name, rarity, ID, price, remaining quantity, and Listing link in both text and escaped HTML. Keep `beginSend`, Gmail send, `complete`, and ambiguous failure behavior unchanged.

- [ ] **Step 7: Run digest tests to verify they pass**

Run the Step 4 command again.

Expected: all listed Functions tests PASS, including existing recovery cases.

- [ ] **Step 8: Commit the batched digest**

```bash
git add functions/src/cardNameSubscriptions.ts functions/src/cardNameSubscriptions.test.ts functions/src/dailyDigest.ts functions/src/dailyDigest.test.ts
git commit -m "feat: match daily digests by card name substring"
```

---

### Task 4: Production Function Adapters and Node.js 22

**Files:**
- Modify: `functions/src/index.ts`
- Modify: `functions/src/index.test.ts`
- Modify: `functions/src/config.test.ts`
- Modify: `functions/package.json`
- Modify: `firestore.indexes.json`

**Interfaces:**
- Consumes: Task 2 generic event capture and Task 3 `findNewInSequenceRange` interface.
- Produces: the unchanged three-export Functions manifest running on Node.js 22 with Firestore adapters for `cardNames` and generic sequence reads.

- [ ] **Step 1: Write failing adapter and runtime contract tests**

In `functions/src/index.test.ts`, preserve the exact export assertion and add:

```ts
const functionsPackage = JSON.parse(await readFile(
  new URL('../package.json', import.meta.url),
  'utf8',
)) as { engines?: { node?: string } };

expect(functionsPackage.engines?.node).toBe('22');
```

In `functions/src/config.test.ts`, replace the daily character-index expectation with an assertion that `firestore.indexes.json` no longer contains fields `characterKey` plus `capturedSequence`. Keep the separate retained Discord-index test unchanged.

- [ ] **Step 2: Run adapter tests to verify they fail**

Run:

```bash
npm --prefix functions test -- src/index.test.ts src/config.test.ts
```

Expected: FAIL because the runtime is Node.js 20 and the obsolete character index remains.

- [ ] **Step 3: Adapt production Firestore reads and event capture**

In `functions/src/index.ts`:

- read `data.cardNames as string[]` into the Functions `NotificationSubscription`;
- replace the character query adapter with `findNewInSequenceRange` using `capturedSequence > afterSequence`, `capturedSequence <= throughSequence`, ascending order, and `.limit(limit)`;
- map snapshots to generic `ListingEvent` values;
- call generic `captureListingEventData` with `{ discordEnabled: false }` exactly as before;
- keep only `captureListingEvent`, `dailyDigestOperator`, and `sendDailyDigest` exported.

Use this query shape:

```ts
const snapshot = await firestore.collection('listingEvents')
  .where('capturedSequence', '>', afterSequence)
  .where('capturedSequence', '<=', throughSequence)
  .orderBy('capturedSequence', 'asc')
  .limit(limit)
  .get();
```

- [ ] **Step 4: Upgrade runtime and remove the obsolete index declaration**

Set:

```json
"engines": {
  "node": "22"
}
```

Remove only the `characterKey + capturedSequence` index object from `firestore.indexes.json`. Do not change Gmail secrets or add Discord configuration.

- [ ] **Step 5: Run the full Functions suite and build**

Run:

```bash
npm run test:functions
npm run build:functions
```

Expected: all Functions tests PASS and TypeScript build exits 0 under the local compatible Node runtime.

- [ ] **Step 6: Commit adapters and runtime configuration**

```bash
git add functions/src/index.ts functions/src/index.test.ts functions/src/config.test.ts functions/package.json firestore.indexes.json
git commit -m "chore: run generic notification functions on node 22"
```

---

### Task 5: Firestore Subscription Rules

**Files:**
- Modify: `firestore.rules`
- Modify: `src/rules/firebaseRules.test.ts`

**Interfaces:**
- Consumes: Task 1 client document shape.
- Produces: owner-only `notificationSubscriptions/{uid}` access for exactly `cardNames`, `emailDailyEnabled`, and `updatedAt`.

- [ ] **Step 1: Rewrite Rules Emulator fixtures and add failing cases**

Use this valid fixture:

```ts
const subscriptionData = {
  cardNames: ['江戶川柯南', '洗牌情緣'],
  emailDailyEnabled: true,
  updatedAt: new Date(),
};
```

Assert the owner can create, read, update to `cardNames: []`, and delete it. Assert another authenticated user and an unauthenticated user cannot read or write it.

Add rejection tests for:

```ts
{ characterKeys: ['江戶川柯南'], emailDailyEnabled: true, updatedAt: new Date() }
{ ...subscriptionData, email: 'buyer@example.com' }
{ ...subscriptionData, cardNames: ['江戶川柯南', '江戶川柯南'] }
{ ...subscriptionData, cardNames: Array.from({ length: 101 }, (_, index) => `卡名-${index}`) }
```

- [ ] **Step 2: Run Rules tests to verify they fail**

Run:

```bash
npm run test:rules
```

Expected: FAIL because Rules still require `characterKeys`.

- [ ] **Step 3: Implement the new exact document-shape rule**

Replace the subscription validator with:

```text
request.resource.data.keys().hasOnly(['cardNames', 'emailDailyEnabled', 'updatedAt'])
request.resource.data.keys().hasAll(['cardNames', 'emailDailyEnabled', 'updatedAt'])
request.resource.data.cardNames is list
request.resource.data.cardNames.size() <= 100
request.resource.data.cardNames.toSet().size() == request.resource.data.cardNames.size()
request.resource.data.emailDailyEnabled is bool
request.resource.data.updatedAt is timestamp
```

Keep owner-only reads/writes and every server-only collection denial unchanged.

- [ ] **Step 4: Run Rules tests to verify they pass**

Run `npm run test:rules` again.

Expected: all Emulator tests PASS with zero failures.

- [ ] **Step 5: Commit Rules and Emulator coverage**

```bash
git add firestore.rules src/rules/firebaseRules.test.ts
git commit -m "security: validate card name subscriptions"
```

---

### Task 6: Generic Subscription Control and Listing Surfaces

**Files:**
- Create: `src/features/notifications/CardNameSubscriptionControl.tsx`
- Create: `src/features/notifications/CardNameSubscriptionControl.test.tsx`
- Delete: `src/features/notifications/CharacterSubscriptionControl.tsx`
- Delete: `src/features/notifications/CharacterSubscriptionControl.test.tsx`
- Modify: `src/features/marketplace/MarketplacePage.tsx`
- Modify: `src/features/marketplace/MarketplacePage.test.tsx`
- Modify: `src/features/listings/ListingPage.tsx`
- Modify: `src/features/listings/ListingPage.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: Task 1 `NotificationSubscription.cardNames`, `isKnownSubscriptionCardName`, and `findCoveringSubscription`.
- Produces: `<CardNameSubscriptionControl cardName: string isKnownCardName: boolean />` for Marketplace and Listing detail.

- [ ] **Step 1: Read the project UI skill before changing components**

Read `.codex/skills/ui-ux-pro-max/SKILL.md` completely and apply its accessibility, hierarchy, mobile, and token guidance. Do not replace the established design system or the 480px Listing image cap.

- [ ] **Step 2: Write failing generic-control tests**

Create `CardNameSubscriptionControl.test.tsx` by replacing character-only fixtures with `cardNames`. Cover:

- known complete name displays `訂閱江戶川柯南`;
- unknown/incomplete name renders no mutation control;
- signed-out click shows Google sign-in guidance;
- signed-in read remains loading until the repository resolves;
- subscribe requires explicit daily-email checkbox confirmation;
- saved shape contains `cardNames: ['江戶川柯南']` and `emailDailyEnabled: true`;
- exact subscription displays `取消訂閱江戶川柯南`;
- `['江戶川柯南']` with target `江戶川柯南＆灰原哀` displays `已由「江戶川柯南」訂閱涵蓋` and `管理我的訂閱` but no misleading subscribe button;
- failed saves retain prior state;
- stale reads/saves from a previous authenticated UID never update the current UID.

- [ ] **Step 3: Write failing Marketplace and Listing integration tests**

Marketplace tests must prove:

```text
Event + complete known cardName + empty rarity + empty ID -> subscription control visible
Case + incomplete typed name -> no control
Partner + complete known cardName -> the same generic control
```

Listing tests must prove a resolved Event, Case, Partner, and Character snapshot can render the control, while ambiguous or unavailable legacy metadata cannot.

- [ ] **Step 4: Run component tests to verify they fail**

Run:

```bash
npm test -- src/features/notifications/CardNameSubscriptionControl.test.tsx src/features/marketplace/MarketplacePage.test.tsx src/features/listings/ListingPage.test.tsx
```

Expected: FAIL because the generic component and integrations do not exist.

- [ ] **Step 5: Implement the generic control**

Use this public contract:

```ts
export interface CardNameSubscriptionControlProps {
  cardName: string;
  isKnownCardName: boolean;
}
```

Load the current user's subscription exactly once per component context. Determine:

```ts
const exactSubscription = subscription?.cardNames.includes(cardName) ?? false;
const coveringName = findCoveringSubscription(subscription?.cardNames ?? [], cardName);
const coveredByAnotherName = coveringName !== undefined && coveringName !== cardName;
```

Preserve explicit email confirmation, owner UID isolation, loading gates, disabled saving buttons, and `aria-live` feedback. New subscriptions append the exact selected Card Master name without sorting the persisted data; unsubscription removes only the exact name. The management page owns presentation sorting.

- [ ] **Step 6: Integrate Marketplace and Listing detail**

Marketplace: show the control when the selected `cardName` exactly exists in Card Master for the selected card type. Do not require rarity or ID. Replace the character-only prompt with `想知道包含「<name>」的新商品？`.

Listing detail: show the control when resolved metadata is not ambiguous and the exact resolved name exists anywhere in Card Master. Pass the actual Listing `cardName` so shorter existing subscriptions can display coverage.

Rename CSS hooks from `character-subscription-control` to `card-name-subscription-control`; retain token-based focus rings, 44px controls, mobile wrapping, and existing glass surfaces.

- [ ] **Step 7: Run focused component tests to verify they pass**

Run the Step 4 command again.

Expected: all three test files PASS.

- [ ] **Step 8: Commit the generic subscription UI**

```bash
git add src/features/notifications/CardNameSubscriptionControl.tsx src/features/notifications/CardNameSubscriptionControl.test.tsx src/features/notifications/CharacterSubscriptionControl.tsx src/features/notifications/CharacterSubscriptionControl.test.tsx src/features/marketplace/MarketplacePage.tsx src/features/marketplace/MarketplacePage.test.tsx src/features/listings/ListingPage.tsx src/features/listings/ListingPage.test.tsx src/styles.css
git commit -m "feat: subscribe to complete card names"
```

---

### Task 7: My Subscriptions Management Experience

**Files:**
- Modify: `src/features/notifications/NotificationSettingsPage.tsx`
- Modify: `src/features/notifications/NotificationSettingsPage.test.tsx`
- Modify: `src/features/auth/AuthStatus.tsx`
- Modify: `src/features/auth/AuthStatus.test.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: Task 1 `NotificationSubscription.cardNames` and the existing `#/notifications` route.
- Produces: a signed-in `我的訂閱` page with deterministic display sorting and per-name removal.

- [ ] **Step 1: Re-read the project UI skill for the management surface**

Read `.codex/skills/ui-ux-pro-max/SKILL.md` completely before editing the page. Reuse current CSS custom properties, focus-ring behavior, and responsive breakpoints.

- [ ] **Step 2: Write failing management-page tests**

Update the saved fixture to:

```ts
const savedSubscription: NotificationSubscription = {
  uid: 'buyer-1',
  cardNames: ['洗牌情緣', '江戶川柯南'],
  emailDailyEnabled: true,
  updatedAt: new Date('2026-08-27T00:00:00.000Z'),
};
```

Assert:

- heading is `我的訂閱`;
- names render in `zh-Hant` locale order without mutating persisted order;
- removing `江戶川柯南` saves `cardNames: ['洗牌情緣']`;
- removing the final name saves an empty list and displays `尚未訂閱任何卡名。`;
- the daily email toggle preserves all names;
- signed-out, loading, read-error, save-error, stale-UID, and saving-disabled states remain correct;
- no Discord control is rendered.

- [ ] **Step 3: Write failing navigation and route assertions**

In `AuthStatus.test.tsx`, expect the signed-in link `我的訂閱` to target `#/notifications`. In `App.test.tsx`, update the mocked page and route assertion to heading `我的訂閱`.

- [ ] **Step 4: Run focused tests to verify they fail**

Run:

```bash
npm test -- src/features/notifications/NotificationSettingsPage.test.tsx src/features/auth/AuthStatus.test.tsx src/App.test.tsx
```

Expected: FAIL because the page and navigation still say character notification settings.

- [ ] **Step 5: Implement the management experience**

Rename all local `characterKeys` variables and copy to `cardNames`. Derive display-only order with:

```ts
const sortedCardNames = [...cardNames].sort((left, right) => left.localeCompare(right, 'zh-Hant'));
```

Removal must filter the original `cardNames` array by exact raw equality and save the remaining list with a new `updatedAt`. Keep the email toggle and asynchronous UID-context guard.

Change the nav label to `我的訂閱`. Keep route `#/notifications`; no router or hash migration is needed.

- [ ] **Step 6: Apply responsive and accessible styles**

Rename `subscribed-character-list` to `subscribed-card-name-list`. Keep buttons at least 44px high, allow long names to wrap without overlapping the remove button, stack rows and full-width buttons on narrow screens, and use existing `--border`, `--card`, `--primary`, `--destructive`, and focus-ring tokens. Do not introduce hard-coded theme colors.

- [ ] **Step 7: Run focused tests and production frontend build**

Run:

```bash
npm test -- src/features/notifications/NotificationSettingsPage.test.tsx src/features/auth/AuthStatus.test.tsx src/App.test.tsx
npm run build
```

Expected: focused tests PASS and the production build exits 0.

- [ ] **Step 8: Commit management UI**

```bash
git add src/features/notifications/NotificationSettingsPage.tsx src/features/notifications/NotificationSettingsPage.test.tsx src/features/auth/AuthStatus.tsx src/features/auth/AuthStatus.test.tsx src/App.test.tsx src/styles.css
git commit -m "feat: manage card name subscriptions"
```

---

### Task 8: Operations Documentation and Full Release Gate

**Files:**
- Modify: `docs/firebase-setup.md`
- Modify: `functions/src/index.test.ts`

**Interfaces:**
- Consumes: all prior tasks and the fixed production deployment order.
- Produces: an evidence-backed feature branch ready for review, merge, push, and separately approved deployment.

- [ ] **Step 1: Add failing documentation-contract assertions**

In `functions/src/index.test.ts`, require `docs/firebase-setup.md` to contain these exact concepts or commands:

```text
Node.js 22
cardNames
raw substring
no matching new Listings
firebase deploy --only firestore --project conantcgmarket
firebase deploy --only functions --project conantcgmarket
npm test
npm run build
npm run test:rules
npm run test:functions
npm run build:functions
```

Keep existing Gmail secret, Blaze budget, IAM operator, recovery, and web-only GitHub Pages checks.

- [ ] **Step 2: Run the documentation contract to verify it fails**

Run:

```bash
npm --prefix functions test -- src/index.test.ts
```

Expected: FAIL because the setup guide still documents character-only behavior and Node.js 20-era deployment.

- [ ] **Step 3: Update the operations guide**

Document:

- complete Card Master names stored in `cardNames`;
- raw case-sensitive substring matching across all types, IDs, and rarities;
- no email when no matching new Listing exists;
- Node.js 22 runtime;
- Rules first, Functions second, frontend third;
- no production Listing or email used for automated deployment verification;
- existing four Gmail secrets and private operator recovery workflow unchanged.

State that production commands require explicit operator approval and list them exactly:

```bash
firebase deploy --only firestore --project conantcgmarket
firebase deploy --only functions --project conantcgmarket
```

- [ ] **Step 4: Run every automated release gate from repository root**

Run in this order:

```bash
npm test
npm run build
npm run test:functions
npm run build:functions
npm run test:rules
git diff --check
```

Expected:

- frontend Vitest reports zero failed files and tests;
- frontend TypeScript/Vite build exits 0;
- Functions Vitest reports zero failed files and tests;
- Functions TypeScript build exits 0;
- Firestore/Storage Emulator tests report zero failures;
- `git diff --check` prints nothing and exits 0.

- [ ] **Step 5: Verify the local Functions manifest without secrets or email**

Run:

```bash
npm --prefix functions test -- src/index.test.ts
```

Expected: PASS and the manifest assertion lists only:

```text
captureListingEvent
dailyDigestOperator
sendDailyDigest
```

- [ ] **Step 6: Commit documentation after all gates pass**

```bash
git add docs/firebase-setup.md functions/src/index.test.ts
git commit -m "docs: operate card name digest notifications"
```

- [ ] **Step 7: Perform final branch verification**

Run:

```bash
git status --short
git log --oneline --decorate -10
git diff main...HEAD --stat
```

Expected: no tracked modifications remain; only known user-owned untracked files may appear. Confirm the branch contains the spec, plan, implementation commits, and no unrelated files.

- [ ] **Step 8: Stop for release approval**

Report test counts, build results, Rules results, commit list, Node.js runtime, and exact production deployment commands. Do not merge, push, deploy, delete old test documents, create a production Listing, or send a test email until the user explicitly approves the release action.
