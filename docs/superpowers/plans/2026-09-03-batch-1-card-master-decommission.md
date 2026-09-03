# Batch 1 Card Master Decommission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the obsolete public Card Master page, development fallback records, and legacy Card Master read/deduplication behavior while retaining strict canonical Card Master reads for Marketplace and listing flows.

**Architecture:** Firestore `cards` documents are a fail-closed four-field contract validated by `cardConverter`; the repository sorts but never merges them. Marketplace resolves metadata from Listing snapshots and canonical Firestore cards only. The retired `#/cards` route canonicalizes to Marketplace, while a future admin-only surface remains deferred to Batch 8.

**Tech Stack:** React 19, TypeScript, Firebase Web SDK and Emulator Suite, Vitest, Testing Library, Playwright, Vite, Node.js 22.

**Spec:** `docs/superpowers/specs/2026-09-03-batch-1-card-master-decommission-design.md`

## Global Constraints

- Run every Node command under Node.js 22, matching `.github/workflows/deploy.yml`.
- Load the repository-root `.env` only for local test/build configuration; never print its values.
- Do not write, import, update, or delete production Firebase data in this batch.
- Card Master documents contain exactly `cardId`, `cardType`, `cardName`, and `rarities`.
- Do not store or expose official images, image URLs, effect text, traits, or Rugia-internal source IDs.
- Preserve legacy Listing snapshot resolution; only legacy Card Master compatibility is removed.
- Preserve Firestore public-read/client-write-denied rules for `cards`.
- Preserve server-first Card Master reads and non-empty cache fallback behavior.
- Write each behavior test first, run it to observe the expected failure, then implement only enough production code to pass.
- Historical dated specs and plans remain unchanged.

---

### Task 1: Make Card Master conversion canonical and fail closed

**Files:**
- Modify: `src/data/firestore/converters.test.ts`
- Modify: `src/data/firestore/converters.ts`

**Interfaces:**
- Consumes: `validateCard(card: Card): void`, `normalizeCardId(value: string): string`
- Produces: `cardConverter: FirestoreDataConverter<Card>` accepting exactly the four canonical raw fields

- [ ] **Step 1: Replace legacy-success tests with strict-contract failure tests**

Keep the existing normalized composite-key success test. Replace the three legacy conversion tests with this table and add the extra-field case:

```ts
it.each([
  ['document-ID cardId fallback', '0501', { characterName: '諸伏高明', rarities: ['D'] }],
  ['legacy nameZh', '0502', { nameZh: '毛利蘭', rarities: ['SR'] }],
  ['legacy nameJa', '0503', { nameJa: '江戸川コナン', rarities: ['R'] }],
  ['scalar rarity', 'card_scalar', {
    cardId: '0504', cardType: 'character', cardName: '灰原哀', rarity: 'R',
  }],
  ['an extra field', 'card_extra', {
    cardId: '0505', cardType: 'character', cardName: '工藤新一', rarities: ['R'], effect: 'forbidden',
  }],
] as const)('rejects non-canonical Card Master data: %s', (_name, id, data) => {
  const snapshot = { id, data: () => data };

  expect(() => cardConverter.fromFirestore(snapshot as never)).toThrow(
    'Card Master document requires exactly cardId, cardType, cardName, and rarities.',
  );
});
```

- [ ] **Step 2: Run the converter tests and verify RED**

Run:

```bash
source /Users/erinli/.nvm/nvm.sh
nvm use 22
set -a; source ../../.env; set +a
npm test -- src/data/firestore/converters.test.ts
```

Expected: FAIL because the current converter adapts the first four retired shapes and ignores the extra raw field.

- [ ] **Step 3: Add an exact raw-field guard and remove legacy inference**

Add this helper near `readData`:

```ts
const canonicalCardFields = ['cardId', 'cardName', 'cardType', 'rarities'] as const;

function assertCanonicalCardFields(data: FirestoreData) {
  const fields = Object.keys(data).sort();
  if (
    fields.length !== canonicalCardFields.length
    || fields.some((field, index) => field !== canonicalCardFields[index])
  ) {
    throw new Error('Card Master document requires exactly cardId, cardType, cardName, and rarities.');
  }
}
```

Replace `cardConverter.fromFirestore` with strict projection:

```ts
fromFirestore(snapshot, options) {
  const data = readData(snapshot, options);
  assertCanonicalCardFields(data);
  const card: Card = {
    key: snapshot.id,
    cardId: normalizeCardId(data.cardId as string),
    cardType: data.cardType as Card['cardType'],
    cardName: data.cardName as string,
    rarities: data.rarities as string[],
  };

  validateCard(card);
  return card;
},
```

- [ ] **Step 4: Run the converter tests and verify GREEN**

Run the Step 2 command again. Expected: the converter test file passes, including canonical read/write and all unrelated converters.

- [ ] **Step 5: Commit the strict converter**

```bash
git add src/data/firestore/converters.ts src/data/firestore/converters.test.ts
git commit -m "refactor: require canonical card master documents"
```

---

### Task 2: Stop merging Card Master records in the client repository

**Files:**
- Modify: `src/data/firestore/repositories/cardRepository.test.ts`
- Modify: `src/data/firestore/repositories/cardRepository.ts`

**Interfaces:**
- Consumes: converter-validated `Card` objects
- Produces: `sortCards(cards: readonly Card[]): Card[]` as an internal stable ordering operation
- Preserves: `listCards`, `listCardsFromServer`, `getCard`, and exported `searchCards`

- [ ] **Step 1: Replace the merge behavior test with a retain-and-sort test**

Replace `merges legacy and composite-key cards...` with:

```ts
it('retains every canonical record and sorts without hiding duplicate identities', async () => {
  const duplicateB: Card = {
    key: 'card_b', cardId: '0501', cardType: 'character', cardName: '諸伏高明', rarities: ['D'],
  };
  const laterCard: Card = {
    key: 'card_z', cardId: '1096', cardType: 'character', cardName: '諸伏景光', rarities: ['R'],
  };
  const duplicateA: Card = {
    key: 'card_a', cardId: '0501', cardType: 'character', cardName: '諸伏高明', rarities: ['D'],
  };
  firestore.getDocs.mockResolvedValue({
    docs: [duplicateB, laterCard, duplicateA].map((card) => ({ data: () => card })),
  });

  await expect(listCards()).resolves.toEqual([duplicateA, duplicateB, laterCard]);
});
```

- [ ] **Step 2: Run the repository tests and verify RED**

```bash
source /Users/erinli/.nvm/nvm.sh
nvm use 22
set -a; source ../../.env; set +a
npm test -- src/data/firestore/repositories/cardRepository.test.ts
```

Expected: FAIL because `mergeCardsByCanonicalIdentity` collapses `duplicateA` and `duplicateB`.

- [ ] **Step 3: Replace merge logic with stable sorting**

Delete `canonicalIdentity` and `mergeCardsByCanonicalIdentity`. Keep `compareCards`, and add:

```ts
function sortCards(cards: readonly Card[]): Card[] {
  return [...cards].sort(compareCards);
}
```

Change all three list-result paths:

```ts
return sortCards(snapshot.docs.map((document) => document.data()));
```

Use the same expression for the normal query, server query, and non-empty cache result.

- [ ] **Step 4: Run the repository tests and verify GREEN**

Run the Step 2 command again. Expected: all repository tests pass; server-first and cache behavior remain covered.

- [ ] **Step 5: Commit the repository invariant**

```bash
git add src/data/firestore/repositories/cardRepository.ts src/data/firestore/repositories/cardRepository.test.ts
git commit -m "refactor: stop merging card master records in clients"
```

---

### Task 3: Remove Marketplace development fallback behavior

**Files:**
- Modify: `src/features/marketplace/MarketplacePage.test.tsx`
- Modify: `src/features/marketplace/MarketplacePage.tsx`
- Delete: `src/features/marketplace/marketplaceCatalog.ts`
- Delete: `src/features/marketplace/marketplaceCatalog.test.ts`
- Delete: `src/data/cards/developmentCards.ts`
- Delete: `src/data/cards/developmentCards.test.ts`

**Interfaces:**
- Consumes: `resolveListingMetadata(listing: Listing, cards: readonly Card[]): ResolvedListingMetadata`
- Produces: Marketplace records derived only from Listing snapshots and loaded Firestore Card Master records

- [ ] **Step 1: Add a Marketplace regression test for an absent canonical card**

Add to `MarketplacePage.test.tsx`:

```tsx
it('does not invent metadata when a legacy Listing ID is absent from Card Master', async () => {
  render(
    <MarketplacePage
      loadListings={async () => [{
        ...activeListing,
        id: 'missing-card-master-listing',
        cardId: '0002',
        cardType: undefined,
        cardName: undefined,
        characterName: undefined,
        rarity: undefined,
      }]}
      loadCards={async () => []}
      loadSeller={async () => seller}
    />,
  );

  expect(await screen.findByRole('heading', { name: '未提供卡片名稱' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '毛利蘭' })).toBeNull();
});
```

- [ ] **Step 2: Run the Marketplace test and verify RED**

```bash
source /Users/erinli/.nvm/nvm.sh
nvm use 22
set -a; source ../../.env; set +a
npm test -- src/features/marketplace/MarketplacePage.test.tsx
```

Expected: FAIL because `developmentCards` resolves `0002` to the stale hard-coded `毛利蘭` record.

- [ ] **Step 3: Route Marketplace metadata directly through the shared resolver**

In `MarketplacePage.tsx`:

```ts
import { resolveListingMetadata } from '../../domain/listingMetadata';
```

Remove the `developmentCards` and `resolveMarketplaceListingMetadata` imports, then replace the record mapping call with:

```ts
metadata: resolveListingMetadata(listing, loadedCards),
```

- [ ] **Step 4: Run the Marketplace test and verify GREEN**

Run the Step 2 command again. Expected: all Marketplace tests pass and the missing-card test renders the explicit unavailable label.

- [ ] **Step 5: Delete the now-unreferenced fallback modules and verify references**

Delete the four fallback source/test files listed above, then run:

```bash
rg -n "developmentCards|resolveMarketplaceListingMetadata|marketplaceCandidates|marketplaceCatalog" src e2e scripts
```

Expected: no matches and `rg` exit code 1.

- [ ] **Step 6: Re-run affected unit tests**

```bash
npm test -- src/features/marketplace/MarketplacePage.test.tsx src/domain/listingMetadata.test.ts src/data/firestore/repositories/cardRepository.test.ts
```

Expected: all selected test files pass.

- [ ] **Step 7: Commit the fallback removal**

```bash
git add src/features/marketplace src/data/cards
git commit -m "refactor: remove marketplace development card fallback"
```

---

### Task 4: Retire the public Card Master route and page

**Files:**
- Modify: `src/route.test.ts`
- Modify: `src/route.ts`
- Modify: `src/App.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Delete: `src/features/cards/CardMasterPage.tsx`
- Delete: `src/features/cards/CardMasterPage.test.tsx`
- Delete: `src/features/cards/CardSelector.tsx`
- Delete: `src/features/cards/CardSelector.test.tsx`

**Interfaces:**
- Produces: `AppRoute` without `cards`
- Produces: `canonicalHomeHash('#/cards') === '#'`
- Preserves: public Marketplace and all profile, sell, dashboard, notification, listing-detail, and listing-edit routes

- [ ] **Step 1: Write the retired-route tests**

Replace the current cards-route test in `route.test.ts` with:

```ts
it('canonicalizes the retired cards hash to the marketplace home', () => {
  expect(canonicalHomeHash('#/cards')).toBe('#');
  expect(getAppRoute(canonicalHomeHash('#/cards'))).toBe('marketplace');
});
```

Replace the two public Card Master tests in `App.test.tsx` with:

```tsx
it('renders Marketplace for the retired cards hash', () => {
  window.location.hash = '#/cards';

  render(<App />);

  expect(screen.getByRole('heading', { name: 'marketplace page' })).toBeTruthy();
  expect(window.location.hash).not.toBe('#/cards');
});
```

Remove the `listCardsFromServer` import, repository mock, and related `beforeEach`/`afterEach` mock resets from `App.test.tsx`.

- [ ] **Step 2: Run route and App tests and verify RED**

```bash
source /Users/erinli/.nvm/nvm.sh
nvm use 22
set -a; source ../../.env; set +a
npm test -- src/route.test.ts src/App.test.tsx
```

Expected: FAIL because `#/cards` still maps to and renders `CardMasterPage`.

- [ ] **Step 3: Remove the route and canonicalize its legacy hash**

Change the route union and hash canonicalization:

```ts
export type AppRoute = 'marketplace' | 'profile' | 'sell' | 'dashboard' | 'notifications';

export function canonicalHomeHash(hash: string): string {
  return hash === '#/' || hash === '#/cards' ? '#' : hash;
}
```

Delete the `/cards` switch case from `getAppRoute`. Remove the `CardMasterPage` import and `route === 'cards'` branch from `App.tsx`.

- [ ] **Step 4: Run route and App tests and verify GREEN**

Run the Step 2 command again. Expected: both test files pass.

- [ ] **Step 5: Delete the public page and page-only selector**

Delete the four `CardMasterPage` and `CardSelector` source/test files listed above.

Remove every CSS rule whose selector is exclusively one of:

```text
.card-master-page
.card-master-page .eyebrow
.card-master-state
.card-selector
.card-selector-search
.card-selector-search input
.card-selector-selected
.card-selector-selected p
.card-selector-empty
.card-selector-selected button
.card-selector-results
.card-selector-option
.card-selector-option > :first-child
.card-selector-id
.card-selector-option:hover
.card-selector-rarity
```

For grouped rules, remove only the listed selector and retain unrelated selectors and declarations.

- [ ] **Step 6: Verify the application graph and focused tests**

```bash
rg -n "CardMasterPage|CardSelector|route === 'cards'|return 'cards'" src
npm test -- src/route.test.ts src/App.test.tsx src/components/CardMetadataSelector.test.tsx src/features/sell/SellPage.test.tsx
```

Expected: `rg` has no matches; all selected tests pass.

- [ ] **Step 7: Commit the public-page removal**

```bash
git add src/App.tsx src/App.test.tsx src/route.ts src/route.test.ts src/features/cards src/styles.css
git commit -m "refactor: retire public card master page"
```

---

### Task 5: Update browser coverage and current-state documentation

**Files:**
- Modify: `e2e/smoke.spec.ts`
- Modify: `e2e/mobile-forms.spec.ts`
- Delete: `e2e/card-master.spec.ts`
- Modify: `docs/integration-testing.md`
- Modify: `docs/milestones.md`

**Interfaces:**
- Consumes: retired-route behavior from Task 4
- Produces: browser and documentation contracts that no longer advertise a general-user Card Master page

- [ ] **Step 1: Change the deployed smoke route assertion**

Replace the `#/cards` Card Master block in `e2e/smoke.spec.ts` with:

```ts
await page.goto('#/cards');
await expect(page.getByRole('heading', { name: '搜尋正在販售的柯南 TCG 卡牌' })).toBeVisible();
await expect.poll(() => page.evaluate(() => window.location.hash)).not.toBe('#/cards');
await expectNoSmokeErrors(page, pageErrors, consoleErrors, networkViolations);
```

- [ ] **Step 2: Remove public Card Master interaction from mobile coverage**

Rename the first mobile test to:

```ts
test('mobile welcome, filters, result navigation, and footer remain interactive', async ({ page }) => {
```

Delete the block beginning with `await page.goto('#/cards')` and ending after the Card Master return-to-marketplace assertion. Keep all Marketplace filtering, listing navigation, horizontal-scroll, footer, and remaining form coverage.

- [ ] **Step 3: Delete the dedicated Card Master browser spec**

Delete `e2e/card-master.spec.ts`. Its public page behaviors are intentionally removed, while Card Master-backed Marketplace and listing-create behavior remain covered by `public-marketplace.spec.ts` and `listing-lifecycle.spec.ts`.

- [ ] **Step 4: Update the integration-test inventory**

In `docs/integration-testing.md`:

- change “public marketplace and Card Master browsing” to “public Marketplace browsing and Card Master-backed filtering”;
- remove the `e2e/card-master.spec.ts` table row;
- change the mobile row to “iPhone welcome/filter/navigation interaction and every Profile, Listing, edit, sale, subscription, and notification form”;
- retain the statement that public Card Master reads are server-first because the application still reads the collection.

- [ ] **Step 5: Update the current Card Master milestone**

Replace the Milestone 4 status paragraph with:

```md
Status: implemented as an internal application data source. Firestore Card Master records power Marketplace filtering, listing metadata validation, and listing creation; the retired public validation page and development seed fallback have been removed. Card Master mutations remain denied to clients until the admin-only management workflow is implemented.
```

Replace the Milestone 4 deliverables with:

```md
- Public-read, client-write-denied Firestore `cards` collection.
- Canonical `cardId`, `cardType`, `cardName`, and `rarities` document fields.
- Controlled Rugia synchronization and deterministic composite-key import.
- Normalized Card Master search and metadata helpers used inside Marketplace and listing creation.
- Reusable `CardMetadataSelector` for Card Master-backed application workflows.
```

Do not edit historical dated specs or plans.

- [ ] **Step 6: Run current-reference and formatting checks**

```bash
rg -n "card-master\.spec|CardMasterPage|CardSelector|developmentCards|marketplaceCatalog|mergeCardsByCanonicalIdentity" src e2e scripts docs/integration-testing.md docs/milestones.md
rg -n "#/cards" src/route.ts src/route.test.ts src/App.test.tsx e2e/smoke.spec.ts
git diff --check
```

Expected: the removed implementation scan has no matches; the retired hash appears only in canonical redirect code and its unit/integration/browser regression coverage; there are no whitespace errors. Matches inside historical `docs/superpowers` files are intentionally outside this scan.

- [ ] **Step 7: Commit E2E and documentation changes**

```bash
git add e2e docs/integration-testing.md docs/milestones.md
git commit -m "docs: retire public card master coverage"
```

---

### Task 6: Verify Batch 1 end to end

**Files:**
- Verify only; modify files only if a failing test exposes a Batch 1 regression, and then return to a new red-green cycle before continuing

**Interfaces:**
- Consumes: all Batch 1 acceptance criteria
- Produces: fresh verification evidence for the Batch 1 completion gate

- [ ] **Step 1: Install Functions dependencies deterministically**

```bash
source /Users/erinli/.nvm/nvm.sh
nvm use 22
npm --prefix functions ci
```

Expected: install exits 0 without modifying either lockfile.

- [ ] **Step 2: Run root, script, and Functions quality gates**

```bash
set -a; source ../../.env; set +a
npm test
npm run test:scripts
npm run test:functions
npm --prefix functions run lint
npm run build:functions
npm run build
```

Expected: every command exits 0 with zero failed tests and zero TypeScript/lint/build errors.

- [ ] **Step 3: Run Firestore and Storage Rules tests**

```bash
npm run test:rules
```

Expected: Emulator Suite exits 0 and all Rules tests pass. No production Firebase project is used.

- [ ] **Step 4: Run Chromium emulator E2E**

```bash
npm run test:e2e:chromium
```

Expected: Emulator Suite exits 0 and every Chromium Playwright test passes with no flaky retry.

- [ ] **Step 5: Run the final requirement and worktree audit**

```bash
rg -n "card-master\.spec|CardMasterPage|CardSelector|developmentCards|marketplaceCatalog|mergeCardsByCanonicalIdentity" src e2e scripts docs/integration-testing.md docs/milestones.md
rg -n "#/cards" src/route.ts src/route.test.ts src/App.test.tsx e2e/smoke.spec.ts
awk '/export const cardConverter/{flag=1} flag{print} flag && /^};$/{exit}' src/data/firestore/converters.ts | rg -n "characterName|nameZh|nameJa|data\.rarity"
git diff --check
git status -sb
git log --oneline --decorate -8
```

Expected:

- the removed implementation scan returns no matches;
- the retired hash appears only in redirect code and regression coverage;
- the `cardConverter` legacy-field scan returns no matches;
- `git diff --check` returns no output;
- only intentional committed Batch 1 changes exist;
- the spec, plan, and five implementation commits are visible on `codex/recovery-batches-1-11`.

- [ ] **Step 6: Review the Batch 1 acceptance criteria against evidence**

Read the spec acceptance criteria line by line and map each one to the converter tests, repository tests, Marketplace tests, route/App tests, browser tests, reference scans, or build output. If any criterion lacks direct evidence, add the missing failing test and repeat its red-green cycle before declaring Batch 1 complete.
