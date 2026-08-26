# Multi-Card Type Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add character, event, Case, and Partner cards to Card Master, listing creation, marketplace display and filtering, including a separate four-digit ID search while keeping character-only notifications.

**Architecture:** Keep one `cards/{cardId}` collection and normalize every Card to `cardType + cardName + rarities`; converters adapt legacy `characterName` documents at read time. Listings snapshot the generic metadata and retain `characterName` only for character cards. The marketplace filters active Listing snapshots locally, while the controlled Rugia synchronizer and importer validate the complete dataset before any Firestore upsert.

**Tech Stack:** React, TypeScript, Vite, Firebase Auth/Firestore/Storage/Functions, Vitest, Testing Library, Node test runner, Firebase Emulator rules tests

**Spec:** `docs/superpowers/specs/2026-08-26-multi-card-types-design.md`

## Global Constraints

- Persist only `cardId`, `cardType`, `cardName`, and `rarities` in Card Master.
- Never store official card images, image URLs, card effects, traits, or unapproved source fields.
- `cardId` remains exactly four decimal digits, including leading zeroes, and remains the Firestore document ID.
- UI labels are `角色卡`, `事件卡`, `Case 卡（情境卡）`, and `Partner 卡（拍檔卡）`.
- Character subscription and daily Email behavior remains character-card-only.
- Do not import into production without a fresh conflict/count report and explicit user approval.
- Preserve legacy Card and Listing reads throughout the migration.
- Every behavior change follows red-green-refactor and ends with focused tests plus a commit.

---

### Task 1: Generic Card types and legacy Firestore conversion

**Files:**
- Create: `src/domain/cardType.ts`
- Modify: `src/domain/models/card.ts`
- Modify: `src/data/firestore/converters.ts`
- Modify: `src/domain/models/domainModels.test.ts`
- Modify: `src/data/firestore/converters.test.ts`
- Modify: `src/data/cards/developmentCards.ts`
- Modify: `src/data/cards/developmentCards.test.ts`

**Interfaces:**
- Produces: `CardType`, `CARD_TYPES`, `isCardType(value): value is CardType`, and `cardTypeLabel(type): string`.
- Produces: `Card { id, cardType, cardName, rarities }` as the normalized application shape.
- Consumes later: all selector, import, listing, and notification tasks use these exact names.

- [ ] **Step 1: Write failing model and converter tests**

Add cases equivalent to:

```ts
expect(() => validateCard({
  id: '1100', cardType: 'event', cardName: '追跡開始', rarities: ['C'],
})).not.toThrow();
expect(() => validateCard({
  id: '1100', cardType: 'unknown', cardName: '追跡開始', rarities: ['C'],
} as never)).toThrow('Card requires a supported cardType.');

expect(cardConverter.fromFirestore(snapshot('0501', {
  characterName: '諸伏高明', rarities: ['D'],
}), {})).toMatchObject({
  id: '0501', cardType: 'character', cardName: '諸伏高明', rarities: ['D'],
});
```

Assert `toFirestore` writes exactly `cardType`, `cardName`, and `rarities`, not `characterName`.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- src/domain/models/domainModels.test.ts src/data/firestore/converters.test.ts src/data/cards/developmentCards.test.ts`

Expected: FAIL because `CardType`, `cardType`, and `cardName` do not exist.

- [ ] **Step 3: Implement normalized types and compatibility conversion**

Implement:

```ts
export const CARD_TYPES = ['character', 'event', 'case', 'partner'] as const;
export type CardType = typeof CARD_TYPES[number];

export const CARD_TYPE_LABELS: Record<CardType, string> = {
  character: '角色卡',
  event: '事件卡',
  case: 'Case 卡（情境卡）',
  partner: 'Partner 卡（拍檔卡）',
};
```

Make `cardConverter.fromFirestore` map legacy `characterName ?? nameZh ?? nameJa` to `cardName` and default missing `cardType` to `character`. Convert all development fixtures to the normalized shape.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- src/domain/models/domainModels.test.ts src/data/firestore/converters.test.ts src/data/cards/developmentCards.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/cardType.ts src/domain/models/card.ts src/data/firestore/converters.ts src/domain/models/domainModels.test.ts src/data/firestore/converters.test.ts src/data/cards/developmentCards.ts src/data/cards/developmentCards.test.ts
git commit -m "refactor: normalize card type and name metadata"
```

### Task 2: Type-aware metadata helpers and reusable selector

**Files:**
- Modify: `src/domain/cardMetadata.ts`
- Modify: `src/domain/cardMetadata.test.ts`
- Modify: `src/components/CardMetadataSelector.tsx`
- Modify: `src/components/CardMetadataSelector.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `CardType`, `CARD_TYPES`, `cardTypeLabel`, normalized `Card`.
- Produces: `CardMetadataValue { cardType, cardName, rarity, cardId }`.
- Produces: `getCardNameSuggestions(cards, cardType, query)`, `getRaritiesForMetadata(cards, cardType, cardName)`, `getCardIdsForMetadata(cards, cardType, cardName, rarity)`, and `hasKnownCardMetadata(cards, values)`.
- Produces: `CardMetadataSelector` prop `showCardId?: boolean`, defaulting to `true`.

- [ ] **Step 1: Write failing helper and component tests**

Use fixtures from all four types and assert:

```ts
expect(getCardNameSuggestions(cards, 'event', '追')).toEqual(['追跡開始']);
expect(getRaritiesForMetadata(cards, 'case', '緋色の真相')).toEqual(['C']);
expect(getCardIdsForMetadata(cards, 'partner', '江戶川柯南', 'P')).toEqual(['1167']);
expect(hasKnownCardMetadata(cards, {
  cardType: 'event', cardName: '追跡開始', rarity: 'C', cardId: '1100',
})).toBe(true);
```

Render the selector, choose `事件卡`, type `追`, verify the datalist, and verify upstream changes clear downstream values. Render with `showCardId={false}` and assert no `卡片 ID` select exists.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- src/domain/cardMetadata.test.ts src/components/CardMetadataSelector.test.tsx`

Expected: FAIL because helpers still use `characterName` and the selector has no card type.

- [ ] **Step 3: Implement type-aware helpers and selector**

The selector state transition must be:

```ts
onChange({ cardType, cardName: '', rarity: '', cardId: '' });
onChange({ ...value, cardName, rarity: '', cardId: '' });
onChange({ ...value, rarity, cardId: '' });
```

Render the type `<select>` first, retain a text `<input list>` for card name, and conditionally render the dependent ID select. Update CSS to support four columns on wide forms and a stacked mobile layout without overlap.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- src/domain/cardMetadata.test.ts src/components/CardMetadataSelector.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/cardMetadata.ts src/domain/cardMetadata.test.ts src/components/CardMetadataSelector.tsx src/components/CardMetadataSelector.test.tsx src/styles.css
git commit -m "feat: add type-aware card metadata selector"
```

### Task 3: Controlled four-type Rugia synchronization and import

**Files:**
- Modify: `scripts/sync-rugia-card-master.mjs`
- Modify: `scripts/sync-rugia-card-master.test.mjs`
- Modify: `src/data/cards/cardImport.ts`
- Modify: `src/data/cards/cardImport.test.ts`
- Modify: `scripts/import-card-master.mjs`
- Modify: `docs/card-master.example.json`
- Modify: `docs/firebase-setup.md`

**Interfaces:**
- Produces JSON records `{ cardId, cardType, cardName, rarities }` only.
- Produces source mapping `角色卡 → character`, `事件卡 → event`, `情境卡 → case`, `拍檔卡 → partner`.
- Produces `validateCardImport(input): ImportedCard[]` with the same four fields.

- [ ] **Step 1: Write failing parser and import tests**

Add one `cardHolder` fixture per source type. Assert the projection contains only approved fields:

```js
assert.deepEqual(extractApprovedCardRecords(html), [
  { cardId: '0001', cardType: 'character', cardName: '江戶川柯南', rarity: 'R' },
  { cardId: '1100', cardType: 'event', cardName: '追跡開始', rarity: 'C' },
  { cardId: '1150', cardType: 'case', cardName: '緋色の真相', rarity: 'C' },
  { cardId: '1167', cardType: 'partner', cardName: '江戶川柯南', rarity: 'P' },
]);
```

Add rejection tests for unknown source types, duplicate ID with different type/name, forbidden import fields, and invalid IDs.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test scripts/sync-rugia-card-master.test.mjs && npm test -- src/data/cards/cardImport.test.ts`

Expected: FAIL because the parser filters to role cards and the importer accepts legacy fields.

- [ ] **Step 3: Implement full validation before output or write**

Parse all four allowed source labels. Merge only records sharing identical `cardId + cardType + cardName`; merge and sort rarities. Throw an error containing the conflicting ID before returning output when identity differs.

Update the Admin import script to batch-set only:

```js
{ cardType, cardName: cardName.trim(), rarities: normalizedRarities }
```

Do not add deletion. Update the example JSON and deployment documentation with the explicit production-approval gate.

- [ ] **Step 4: Run focused tests and a throwaway source audit**

Run: `node --test scripts/sync-rugia-card-master.test.mjs && npm test -- src/data/cards/cardImport.test.ts`

Then run: `npm run sync:cards -- /tmp/conan-card-master-multi-type.json`

Expected: tests PASS; sync reports nonzero records for all four types and no conflicts. Do not run `npm run import:cards`.

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-rugia-card-master.mjs scripts/sync-rugia-card-master.test.mjs src/data/cards/cardImport.ts src/data/cards/cardImport.test.ts scripts/import-card-master.mjs docs/card-master.example.json docs/firebase-setup.md
git commit -m "feat: sync all approved Conan card types"
```

### Task 4: Generic Listing snapshots and validated sell flow

**Files:**
- Modify: `src/domain/models/listing.ts`
- Modify: `src/domain/models/domainModels.test.ts`
- Modify: `src/data/firestore/converters.ts`
- Modify: `src/data/firestore/converters.test.ts`
- Modify: `src/features/sell/sellForm.ts`
- Modify: `src/features/sell/sellForm.test.ts`
- Modify: `src/features/sell/SellPage.tsx`
- Modify: `src/features/sell/SellPage.test.tsx`

**Interfaces:**
- Produces Listing metadata `{ cardType, cardName, rarity, cardId, characterName? }`.
- Produces `SellFormState` with `cardType` and `cardName`, replacing `characterName` input state.
- Consumes: Task 2 `hasKnownCardMetadata` and `CardMetadataSelector`.

- [ ] **Step 1: Write failing Listing and sell tests**

Assert:

```ts
expect(() => validateListing(eventListing)).not.toThrow();
expect(eventListing.characterName).toBeUndefined();
expect(() => validateListing({
  ...eventListing, cardType: 'event', characterName: '偽角色',
})).toThrow('Non-character Listing cannot contain characterName.');
```

In `SellPage.test.tsx`, select event type/name/rarity/ID, submit valid images and pricing, then expect `createListing` to receive `cardType: 'event'`, `cardName`, and no `characterName`. Add the corresponding character-card assertion where `characterName === cardName`. Assert invalid combinations do not upload images.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- src/domain/models/domainModels.test.ts src/data/firestore/converters.test.ts src/features/sell/sellForm.test.ts src/features/sell/SellPage.test.tsx`

Expected: FAIL because Listing and sell state do not contain generic metadata.

- [ ] **Step 3: Implement snapshots and pre-upload validation**

Require `cardType`, `cardName`, `rarity`, and a four-digit `cardId` for new Listings. Character listings must write `characterName: cardName`; other types must omit the field from Firestore entirely. Legacy `fromFirestore` maps `characterName` to a character type/name only when new fields are absent.

Change user-facing validation to `資料庫找不到這組卡片類型、卡片名稱、稀有度與 ID，請確認後再試。` and keep the current high-contrast metadata error region.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- src/domain/models/domainModels.test.ts src/data/firestore/converters.test.ts src/features/sell/sellForm.test.ts src/features/sell/SellPage.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/models/listing.ts src/domain/models/domainModels.test.ts src/data/firestore/converters.ts src/data/firestore/converters.test.ts src/features/sell/sellForm.ts src/features/sell/sellForm.test.ts src/features/sell/SellPage.tsx src/features/sell/SellPage.test.tsx
git commit -m "feat: create listings for all card types"
```

### Task 5: Marketplace filters with independent ID search

**Files:**
- Create: `src/components/CardIdSearchField.tsx`
- Create: `src/components/CardIdSearchField.test.tsx`
- Modify: `src/listingFilters.ts`
- Modify: `src/listingFilters.test.ts`
- Modify: `src/features/marketplace/MarketplacePage.tsx`
- Modify: `src/features/marketplace/MarketplacePage.test.tsx`
- Modify: `src/features/marketplace/marketplaceCatalog.ts`
- Modify: `src/features/marketplace/marketplaceCatalog.test.ts`
- Modify: `src/styles.css`

**Interfaces:**
- Produces `CardIdSearchField({ value, onChange, error })` using `type="text"`, `inputMode="numeric"`, and `maxLength={4}`.
- Produces Marketplace filters `{ cardType?, cardName?, rarity?, cardIdQuery?, hasSleeve, supportsMyShip }`.
- Consumes: Task 2 selector with `showCardId={false}`.

- [ ] **Step 1: Write failing filter and page tests**

Assert ID behavior:

```ts
expect(filterListings(listings, base({ cardIdQuery: '05' }))).toEqual([listing0501]);
expect(filterListings(listings, base({ cardIdQuery: '0501' }))).toEqual([listing0501]);
expect(validateCardIdQuery('05a')).toBe('卡片 ID 只能輸入最多 4 位數字。');
```

Render Marketplace, verify the independent `搜尋卡片 ID` input exists when no type is selected, and verify it composes with an event type and shipping filter. Assert `CardMetadataSelector` no longer renders its dependent ID select on Marketplace.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- src/components/CardIdSearchField.test.tsx src/listingFilters.test.ts src/features/marketplace/marketplaceCatalog.test.ts src/features/marketplace/MarketplacePage.test.tsx`

Expected: FAIL because independent ID query and generic listing resolution do not exist.

- [ ] **Step 3: Implement local composite filtering and responsive UI**

Normalize ID query with `trim()` but never convert to number. For lengths 1–3 use `listing.cardId.startsWith(query)`; at length 4 use equality. Invalid query returns no matches only after displaying its field error; it must not issue a Firestore request.

Resolve Listing metadata in this order: new snapshot, legacy character snapshot, Card Master, explicit unavailable labels. Show the type badge, card name, rarity, and ID on every listing card. Only derive `isKnownCharacter` when type is `character`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- src/components/CardIdSearchField.test.tsx src/listingFilters.test.ts src/features/marketplace/marketplaceCatalog.test.ts src/features/marketplace/MarketplacePage.test.tsx`

Expected: PASS at desktop and 375px CSS assertions.

- [ ] **Step 5: Commit**

```bash
git add src/components/CardIdSearchField.tsx src/components/CardIdSearchField.test.tsx src/listingFilters.ts src/listingFilters.test.ts src/features/marketplace/MarketplacePage.tsx src/features/marketplace/MarketplacePage.test.tsx src/features/marketplace/marketplaceCatalog.ts src/features/marketplace/marketplaceCatalog.test.ts src/styles.css
git commit -m "feat: filter marketplace by card type and ID"
```

### Task 6: Listing detail, edit, and Dashboard presentation

**Files:**
- Create: `src/features/listings/ListingMetadata.tsx`
- Create: `src/features/listings/ListingMetadata.test.tsx`
- Modify: `src/features/listings/ListingPage.tsx`
- Modify: `src/features/listings/ListingPage.test.tsx`
- Modify: `src/features/listings/ListingEditPage.tsx`
- Create: `src/features/listings/ListingEditPage.test.tsx`
- Modify: `src/features/dashboard/DashboardPage.tsx`
- Create: `src/features/dashboard/DashboardPage.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Produces reusable `ListingMetadata({ listing, card?, compact? })` for detail, edit summary, and Dashboard.
- Consumes: normalized Listing and Card compatibility results from Tasks 1 and 4.

- [ ] **Step 1: Write failing presentation tests**

Render each card type and assert the exact UI label, name, rarity, and ID. Add a legacy Listing test that renders as `角色卡`. In detail tests, assert only character listings render `訂閱{name}`. In edit tests, assert metadata is displayed read-only and `updateListing` preserves it unchanged.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- src/features/listings/ListingMetadata.test.tsx src/features/listings/ListingPage.test.tsx src/features/listings/ListingEditPage.test.tsx src/features/dashboard/DashboardPage.test.tsx`

Expected: FAIL because shared metadata presentation and some page test files do not exist.

- [ ] **Step 3: Implement reusable metadata presentation**

The component must render semantic text equivalent to:

```tsx
<p className="card-type-badge">{cardTypeLabel(cardType)}</p>
<h2>{cardName}</h2>
<p>{rarity} · ID {cardId}</p>
```

Add compact styles for five-column listing grids and larger detail styles without changing the established 480px image maximum. Keep all metadata absent from edit inputs.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- src/features/listings/ListingMetadata.test.tsx src/features/listings/ListingPage.test.tsx src/features/listings/ListingEditPage.test.tsx src/features/dashboard/DashboardPage.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/listings/ListingMetadata.tsx src/features/listings/ListingMetadata.test.tsx src/features/listings/ListingPage.tsx src/features/listings/ListingPage.test.tsx src/features/listings/ListingEditPage.tsx src/features/listings/ListingEditPage.test.tsx src/features/dashboard/DashboardPage.tsx src/features/dashboard/DashboardPage.test.tsx src/styles.css
git commit -m "feat: display generic listing card metadata"
```

### Task 7: Keep notification events character-only

**Files:**
- Modify: `functions/src/domain.ts`
- Modify: `functions/src/domain.test.ts`
- Modify: `functions/src/listingEvents.ts`
- Modify: `functions/src/listingEvents.test.ts`
- Modify: `functions/src/index.test.ts`

**Interfaces:**
- Consumes: Listing snapshot fields `cardType`, `cardName`, and optional legacy `characterName`.
- Produces: `toCharacterListingEvent(listingId, listing): ListingEventDraft | null`.
- Produces capture result `{ status: 'ignored'; reason: 'non-character-card' }` for non-character cards.

- [ ] **Step 1: Write failing Function tests**

Assert:

```ts
expect(toCharacterListingEvent('event-1', eventListing)).toBeNull();
expect(toCharacterListingEvent('legacy-1', legacyCharacterListing)).toMatchObject({
  characterName: '諸伏景光', characterKey: '諸伏景光',
});
expect(await captureListingEvent(source(eventListing), deps)).toEqual({
  status: 'ignored', reason: 'non-character-card',
});
expect(deps.events.create).not.toHaveBeenCalled();
```

Also assert a new character Listing requires `characterName === cardName`.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm --prefix functions test -- src/domain.test.ts src/listingEvents.test.ts src/index.test.ts`

Expected: FAIL because every active listing currently requires character metadata and becomes an event.

- [ ] **Step 3: Implement character-only capture with legacy compatibility**

Return `null` before event creation for explicit non-character types. Treat missing `cardType` plus valid legacy `characterName` as a character Listing. Keep all existing retry, cursor, Gmail, and Discord delivery semantics unchanged for character events.

- [ ] **Step 4: Run Functions tests and build**

Run: `npm run test:functions && npm run build:functions`

Expected: all Functions tests PASS and TypeScript build exits 0.

- [ ] **Step 5: Commit**

```bash
git add functions/src/domain.ts functions/src/domain.test.ts functions/src/listingEvents.ts functions/src/listingEvents.test.ts functions/src/index.test.ts
git commit -m "fix: restrict character notifications to character cards"
```

### Task 8: Rules regression, full verification, and production handoff

**Files:**
- Modify: `src/rules/firebaseRules.test.ts`
- Modify: `docs/firebase-setup.md`
- Modify: `docs/mvp-acceptance.md` only if it is already tracked at execution time; otherwise create `docs/multi-card-type-acceptance.md`

**Interfaces:**
- Consumes all earlier tasks.
- Produces documented, repeatable local acceptance and a production import report without performing the import.

- [ ] **Step 1: Write failing Emulator and acceptance assertions**

Add Emulator cases proving an authenticated seller can create a Listing containing valid generic snapshot fields, another user cannot mutate it, and public users can read it only while active. Preserve the existing public-read/client-write-denied Card Master tests.

- [ ] **Step 2: Run rules tests and verify expected state**

Run: `npm run test:rules`

Expected before fixture updates: FAIL because test builders do not provide the new required Listing metadata; after the minimal fixture/rule-compatible updates: PASS without opening Card Master client writes.

- [ ] **Step 3: Document local acceptance and production gate**

Document this exact manual scenario:

1. Select `事件卡`, type/select a source-approved event name, choose rarity and ID, then create a Listing.
2. Verify Marketplace can find it using only the first two ID digits and then the exact four digits.
3. Verify type/name/rarity filters compose with ID, sleeve, and MyShip filters.
4. Verify Listing detail and Dashboard show type, name, rarity, and ID.
5. Verify no character subscription control appears for the event card.
6. Verify a legacy character Listing still renders and remains subscribable.

Record the throwaway sync output counts and conflict count. State that `npm run import:cards -- <file>` remains blocked pending explicit approval.

- [ ] **Step 4: Run the complete verification suite**

Run:

```bash
npm test
npm run build
npm run test:rules
npm run test:functions
npm run build:functions
node --test scripts/sync-rugia-card-master.test.mjs
git diff --check
```

Expected: all commands exit 0. The Vite bundle-size warning may remain, but no tests or builds may fail.

- [ ] **Step 5: Commit verification fixtures and handoff docs**

```bash
git add src/rules/firebaseRules.test.ts docs/firebase-setup.md docs/multi-card-type-acceptance.md
git commit -m "test: verify multi-card type marketplace flow"
```

If execution used the already tracked `docs/mvp-acceptance.md`, stage that file instead of `docs/multi-card-type-acceptance.md`; never add unrelated untracked documents.

After this commit, report the generated Card Master file path, record counts by type, conflict count, complete verification output, and the exact production command that remains unexecuted pending approval.
