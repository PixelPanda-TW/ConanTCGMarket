# Card Identity and String IDs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support visible card IDs `0001` and `P001`, allow one visible ID to identify multiple Card Master records, and keep legacy Listings safe when their card ID is ambiguous.

**Architecture:** Separate internal Card Master identity (`Card.key`, the Firestore document ID) from the visible searchable `Card.cardId`. New Card Master documents use deterministic SHA-256 composite keys, while the client converter and repository read and deduplicate both new documents and legacy `cards/{cardId}` documents. Listings continue storing visible immutable metadata snapshots; card-ID-only legacy Listings resolve through Card Master only when exactly one canonical candidate exists.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Firebase Web SDK, Firebase Admin SDK, Firestore/Storage Emulator, Node.js ESM scripts and `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-26-card-identity-and-string-ids-design.md`

## Global Constraints

- Complete visible IDs must match exactly `^(?:\d{4}|P\d{3})$` after `trim()` and uppercase normalization.
- Marketplace partial ID queries accept an empty string, one to four digits, or `P` followed by zero to three digits.
- Preserve leading zeroes; never convert `cardId` to a number.
- The only source correction is the explicit `B0982 -> 0982` map entry; never strip arbitrary prefixes.
- Card Master identity is `cardType + NFC-trimmed cardName + normalized cardId`; rarity is not part of the identity.
- New Card Master document IDs are `card_` plus the full 64-character SHA-256 hex digest of the canonical tuple JSON.
- Card Master artifacts and documents may contain only `cardId`, `cardType`, `cardName`, and `rarities`.
- Do not store official images, image URLs, effect text, traits, or Rugia internal source IDs such as `PR226`.
- Listing documents must not gain `cardKey`; they continue storing visible `cardId`, `cardType`, `cardName`, `rarity`, and character-only `characterName` snapshots.
- Character subscription semantics remain unchanged and must be disabled for ambiguous card-ID-only legacy Listings.
- The migration only upserts new composite-key documents. It does not delete legacy Card Master documents.
- Do not run the production import, deploy Firebase, deploy GitHub Pages, or push without a separate explicit user instruction.

---

## File Structure

- Create `src/domain/cardId.ts`: browser-safe visible ID normalization, complete validation, and partial-query validation.
- Modify `src/domain/models/card.ts`: expose `Card.key` separately from `Card.cardId` and validate both.
- Modify `src/domain/models/listing.ts`: accept both approved complete visible ID formats for new Listings.
- Modify `src/data/firestore/converters.ts`: read new and legacy Card Master documents and write the four allowlisted fields.
- Modify `src/data/firestore/repositories/cardRepository.ts`: deduplicate new and legacy Card Master documents by canonical identity.
- Modify `src/domain/cardMetadata.ts`: use visible IDs for matching and `Card.key` for option identity.
- Modify card selection/display files under `src/components`, `src/features/cards`, and `src/data/cards`: stop treating `Card.id` as both key and visible ID.
- Create `scripts/card-master-domain.mjs`: Node-side normalization, composite aggregation, deterministic key generation, and collision detection shared by sync and import scripts.
- Modify `scripts/sync-rugia-card-master.mjs`: parse both ID formats, apply the controlled correction, allow shared IDs, and produce an auditable report.
- Modify `scripts/import-card-master.mjs`: validate and key the complete input before Admin initialization, then upsert composite-key documents without deletion.
- Modify sell and marketplace feature files: accept `P001`, uppercase user input, and preserve independent partial ID filtering.
- Create `src/domain/listingMetadata.ts`: one pure resolver for snapshot-first and ambiguity-safe legacy Listing metadata.
- Modify Listing detail/edit, Marketplace, and Dashboard pages: use the shared legacy resolver and never select the first ambiguous Card Master candidate.
- Modify rules/functions tests and Card Master documentation: preserve public-read/client-write-denied behavior and document the migration contract.

### Task 1: Visible Card ID Domain Contract

**Files:**
- Create: `src/domain/cardId.ts`
- Create: `src/domain/cardId.test.ts`
- Modify: `src/domain/models/card.ts`
- Modify: `src/domain/models/listing.ts`
- Modify: `src/domain/models/domainModels.test.ts`

**Interfaces:**
- Produces: `CARD_ID_PATTERN`, `normalizeCardId(value: string): string`, `isCompleteCardId(value: string): boolean`, `normalizeCardIdQuery(value: string): string`, and `validateCardIdQuery(value?: string): string | undefined`.
- Produces: `Card { key: string; cardId: string; cardType: CardType; cardName: string; rarities: readonly string[] }`.
- Consumes: existing `CardType` and `isCardType` from `src/domain/cardType.ts`.

- [ ] **Step 1: Write failing normalization and validation tests**

```ts
expect(normalizeCardId(' p001 ')).toBe('P001');
expect(isCompleteCardId('0001')).toBe(true);
expect(isCompleteCardId('P001')).toBe(true);
expect(isCompleteCardId('B0982')).toBe(false);
expect(validateCardIdQuery('P00')).toBeUndefined();
expect(validateCardIdQuery('p001')).toBeUndefined();
expect(validateCardIdQuery('P0001')).toBe('卡片 ID 請輸入 4 位數字，或 P 加 3 位數字。');
```

Add model assertions that `validateCard` accepts `{ key: 'card_hash', cardId: 'P001', ... }`, `validateListing` accepts a normalized `P001` snapshot, and both reject `P01`, `B0982`, and lowercase complete values that were not normalized at the boundary.

- [ ] **Step 2: Run the focused tests and confirm the old four-digit assumptions fail**

Run: `npm test -- src/domain/cardId.test.ts src/domain/models/domainModels.test.ts`

Expected: FAIL because `cardId.ts` does not exist and the current models only accept four numeric digits through `Card.id`.

- [ ] **Step 3: Implement the browser-safe ID helpers and update the models**

```ts
export const CARD_ID_PATTERN = /^(?:\d{4}|P\d{3})$/;
const CARD_ID_QUERY_PATTERN = /^(?:\d{0,4}|P\d{0,3})$/;
const CARD_ID_ERROR = '卡片 ID 請輸入 4 位數字，或 P 加 3 位數字。';

export function normalizeCardId(value: string): string {
  return value.trim().toUpperCase();
}

export function isCompleteCardId(value: string): boolean {
  return CARD_ID_PATTERN.test(value);
}

export function normalizeCardIdQuery(value: string): string {
  return value.trim().toUpperCase();
}

export function validateCardIdQuery(value?: string): string | undefined {
  return CARD_ID_QUERY_PATTERN.test(normalizeCardIdQuery(value ?? '')) ? undefined : CARD_ID_ERROR;
}
```

Change `Card.id` to `Card.key` plus `Card.cardId`. Validate `key` as a non-empty string, validate `cardId` with `isCompleteCardId`, and update Listing validation to use the same helper when `allowLegacyCardMetadata` is false.

- [ ] **Step 4: Run the focused tests**

Run: `npm test -- src/domain/cardId.test.ts src/domain/models/domainModels.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the domain contract**

```bash
git add src/domain/cardId.ts src/domain/cardId.test.ts src/domain/models/card.ts src/domain/models/listing.ts src/domain/models/domainModels.test.ts
git commit -m "feat: support string card IDs in domain models"
```

### Task 2: Firestore Card Master Compatibility and Deduplication

**Files:**
- Modify: `src/data/firestore/converters.ts`
- Modify: `src/data/firestore/converters.test.ts`
- Modify: `src/data/firestore/repositories/cardRepository.ts`
- Modify: `src/data/firestore/repositories/cardRepository.test.ts`

**Interfaces:**
- Consumes: `Card.key`, `Card.cardId`, and `normalizeCardId` from Task 1.
- Produces: `mergeCardsByCanonicalIdentity(cards: readonly Card[]): Card[]`.
- Produces: `listCards(): Promise<Card[]>` returning canonical, deduplicated new-and-legacy records.
- Produces: `getCard(cardKey: string): Promise<Card | null>` where the argument is the internal document key, not a visible ID.

- [ ] **Step 1: Write failing converter and repository migration tests**

Create cases for:

```ts
expect(cardConverter.fromFirestore(newSnapshot)).toEqual({
  key: 'card_abc', cardId: 'P001', cardType: 'partner', cardName: '江戶川柯南', rarities: ['P'],
});
expect(cardConverter.fromFirestore(legacySnapshot)).toEqual({
  key: '0501', cardId: '0501', cardType: 'character', cardName: '諸伏高明', rarities: ['D'],
});
expect(cardConverter.toFirestore(card)).toEqual({
  cardId: 'P001', cardType: 'partner', cardName: '江戶川柯南', rarities: ['P'],
});
```

In the repository test, return one legacy `cards/0501` record and one new `cards/card_<hash>` record with the same canonical identity but different rarity arrays. Assert `listCards()` returns one record, keeps the new key, and unions sorted rarities. Also return two records with `cardId: '0501'` but different names and assert both remain.

- [ ] **Step 2: Run the converter and repository tests to verify failure**

Run: `npm test -- src/data/firestore/converters.test.ts src/data/firestore/repositories/cardRepository.test.ts`

Expected: FAIL because the converter does not read/write `cardId`, and the repository does not deduplicate canonical identities.

- [ ] **Step 3: Implement compatible conversion and canonical merging**

Use this converter boundary:

```ts
const explicitCardId = typeof data.cardId === 'string' ? normalizeCardId(data.cardId) : undefined;
const card: Card = {
  key: snapshot.id,
  cardId: explicitCardId ?? normalizeCardId(snapshot.id),
  cardType: (data.cardType ?? 'character') as Card['cardType'],
  cardName: (data.cardName ?? data.characterName ?? data.nameZh ?? data.nameJa) as string,
  rarities: Array.isArray(data.rarities) ? data.rarities as string[] : [data.rarity as string],
};
```

Implement repository merging with a canonical JSON key:

```ts
function canonicalIdentity(card: Card): string {
  return JSON.stringify([card.cardType, card.cardName.trim().normalize('NFC'), card.cardId]);
}
```

When identities collide, prefer the record whose `key !== cardId` (the composite-key document) and replace its `rarities` with the sorted union. Sort the final array by `cardId`, then `cardType`, then `cardName`, then `key` for deterministic UI output.

- [ ] **Step 4: Run focused tests and confirm converter/repository behavior**

Run: `npm test -- src/data/firestore/converters.test.ts src/data/firestore/repositories/cardRepository.test.ts`

Expected: PASS, including coexistence of shared visible IDs.

- [ ] **Step 5: Commit Firestore compatibility**

```bash
git add src/data/firestore/converters.ts src/data/firestore/converters.test.ts src/data/firestore/repositories/cardRepository.ts src/data/firestore/repositories/cardRepository.test.ts
git commit -m "feat: read composite and legacy card master records"
```

### Task 3: Card Metadata Helpers and Internal Option Identity

**Files:**
- Modify: `src/domain/cardMetadata.ts`
- Modify: `src/domain/cardMetadata.test.ts`
- Modify: `src/data/cards/cardSearch.test.ts`
- Modify: `src/data/cards/developmentCards.ts`
- Modify: `src/data/cards/developmentCards.test.ts`
- Modify: `src/components/CardMetadataSelector.tsx`
- Modify: `src/components/CardMetadataSelector.test.tsx`
- Modify: `src/features/cards/CardSelector.tsx`
- Modify: `src/features/cards/CardSelector.test.tsx`
- Modify: `src/features/cards/CardMasterPage.tsx`
- Modify: `src/features/cards/CardMasterPage.test.tsx`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Consumes: the new `Card` shape from Task 1.
- Produces: `getCardsForMetadata(cards, cardType, cardName, rarity): Card[]` sorted by visible ID and then key.
- Produces: `hasKnownCardMetadata` matching `card.cardId`, never `card.key`.
- Produces: selector options keyed by `card.key` while displaying and returning normalized `card.cardId`.

- [ ] **Step 1: Update fixtures and write failing shared-ID helper tests**

Use fixtures with distinct keys:

```ts
const cards: readonly Card[] = [
  { key: 'card_a', cardId: '0501', cardType: 'character', cardName: '諸伏高明', rarities: ['D'] },
  { key: 'card_b', cardId: '0501', cardType: 'event', cardName: '事件 0501', rarities: ['D'] },
  { key: 'card_c', cardId: 'P001', cardType: 'partner', cardName: '江戶川柯南', rarities: ['P'] },
];
```

Assert type/name/rarity narrowing returns the correct Card object even when another Card has the same visible ID. In component tests, assert option text is `0501` or `P001`, no hash is rendered, and changing the ID control returns the visible `cardId` in `CardMetadataSelection`. Render two Card Selector results with the same visible ID but different `key` values, assert both remain independently clickable, and spy on `console.error` to ensure React reports no duplicate-key warning.

- [ ] **Step 2: Run metadata and card UI tests to verify failure**

Run: `npm test -- src/domain/cardMetadata.test.ts src/components/CardMetadataSelector.test.tsx src/features/cards/CardSelector.test.tsx src/features/cards/CardMasterPage.test.tsx src/data/cards/cardSearch.test.ts src/data/cards/developmentCards.test.ts src/App.test.tsx`

Expected: FAIL at `Card.id` fixtures and ID-based helper assertions.

- [ ] **Step 3: Migrate helpers and card displays to key/cardId**

Replace ID extraction with:

```ts
export function getCardsForMetadata(
  cards: readonly MetadataCard[], cardType: CardType, cardName: string, rarity: string,
): Card[] {
  if (!cardName.trim() || !rarity.trim()) return [];
  return cards
    .filter((card): card is Card => !isLegacyCard(card)
      && card.cardType === cardType
      && card.cardName === cardName
      && card.rarities.includes(rarity))
    .sort((a, b) => a.cardId.localeCompare(b.cardId) || a.key.localeCompare(b.key));
}
```

Retain the legacy helper overload only at its current compatibility boundary, mapping a legacy record's `id` to the visible value. Everywhere that consumes normalized `Card` must render `card.cardId`, use `card.key` for React keys, and compare visible selections against `card.cardId`.

- [ ] **Step 4: Run metadata/card UI tests**

Run: `npm test -- src/domain/cardMetadata.test.ts src/components/CardMetadataSelector.test.tsx src/features/cards/CardSelector.test.tsx src/features/cards/CardMasterPage.test.tsx src/data/cards/cardSearch.test.ts src/data/cards/developmentCards.test.ts src/App.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit internal Card option identity**

```bash
git add src/domain/cardMetadata.ts src/domain/cardMetadata.test.ts src/data/cards src/components/CardMetadataSelector.tsx src/components/CardMetadataSelector.test.tsx src/features/cards src/App.test.tsx
git commit -m "refactor: separate card keys from visible IDs"
```

### Task 4: Rugia Synchronization with Controlled Correction and Audit Report

**Files:**
- Create: `scripts/card-master-domain.mjs`
- Create: `scripts/card-master-domain.test.mjs`
- Modify: `scripts/sync-rugia-card-master.mjs`
- Modify: `scripts/sync-rugia-card-master.test.mjs`

**Interfaces:**
- Produces: `normalizeSourceCardId(value): { cardId: string; correction: null | { from: string; to: string } }`.
- Produces: `canonicalCardTuple(record): [CardType, string, string]`, `canonicalCardIdentity(record): string`, and `createCardKey(record): string`.
- Produces: `aggregateCardMasterRecords(records): CardArtifactRecord[]` where identical composite identities union sorted uppercase rarities.
- Produces: `syncRugiaCardMaster(fetchImpl): Promise<{ cards: CardArtifactRecord[]; report: SyncReport }>`.
- Produces: `formatSyncReport(report): string` with type counts, ID-format counts, shared-ID groups, duplicate occurrences, corrections, and key collisions.

Use these concrete script data shapes:

```js
/** @typedef {{cardId: string, cardType: 'character'|'event'|'case'|'partner', cardName: string, rarities: string[]}} CardArtifactRecord */
/** @typedef {{
 * versionCount: number,
 * occurrenceCount: number,
 * canonicalCardCount: number,
 * cardTypeCounts: {character: number, event: number, case: number, partner: number},
 * idFormatCounts: {numeric: number, prefixedP: number},
 * sharedCardIdCount: number,
 * duplicateOccurrenceCount: number,
 * corrections: Array<{from: string, to: string, count: number}>,
 * keyCollisionCount: number,
 * }} SyncReport */
```

- [ ] **Step 1: Write failing script-domain and sync tests**

Add assertions that:

```js
assert.deepEqual(normalizeSourceCardId(' p001 '), { cardId: 'P001', correction: null });
assert.deepEqual(normalizeSourceCardId('B0982'), {
  cardId: '0982', correction: { from: 'B0982', to: '0982' },
});
assert.throws(() => normalizeSourceCardId('B0123'), /invalid card ID/);
assert.match(createCardKey({ cardType: 'character', cardName: '中森青子', cardId: '0982' }), /^card_[a-f0-9]{64}$/);
```

Provide mocked HTML containing `P001`, `B0982`, two different names sharing `0501`, and an exact duplicate occurrence. Assert sync returns both shared-ID canonical Cards, corrects only `B0982`, merges the exact duplicate, and reports one correction plus one duplicate occurrence.

- [ ] **Step 2: Run Node script tests and verify failure**

Run: `node --test scripts/card-master-domain.test.mjs scripts/sync-rugia-card-master.test.mjs`

Expected: FAIL because the script-domain module and structured sync result do not exist.

- [ ] **Step 3: Implement the Node-side canonical identity module**

```js
import { createHash } from 'node:crypto';

export const CARD_ID_PATTERN = /^(?:\d{4}|P\d{3})$/;
export const SOURCE_CARD_ID_CORRECTIONS = new Map([['B0982', '0982']]);

export function canonicalCardTuple({ cardType, cardName, cardId }) {
  return [cardType, cardName.trim().normalize('NFC'), cardId.trim().toUpperCase()];
}

export function createCardKey(record) {
  const digest = createHash('sha256').update(JSON.stringify(canonicalCardTuple(record)), 'utf8').digest('hex');
  return `card_${digest}`;
}
```

Validate unknown types, empty names, empty rarities, and unapproved ID formats before aggregation. Track identical four-field occurrence duplicates separately from canonical-card merging.

Expose `buildSyncResult(occurrences, corrections, { createKey = createCardKey } = {})`. It must map generated keys back to canonical tuple JSON, count a collision when one key maps to two tuples, and make the CLI refuse to write the artifact when `keyCollisionCount !== 0`.

- [ ] **Step 4: Update sync parsing, aggregation, and report formatting**

Parse the source-visible ID as a string, call `normalizeSourceCardId`, and retain only `{ cardId, cardType, cardName, rarity }` in returned occurrences. Accumulate correction counts through the normalization result. Return `{ cards, report }`; have the CLI write only `cards` to JSON and print `formatSyncReport(report)`.

The report object must use this stable shape:

```js
{
  versionCount: 23,
  occurrenceCount: 2256,
  canonicalCardCount: 0,
  cardTypeCounts: { character: 0, event: 0, case: 0, partner: 0 },
  idFormatCounts: { numeric: 0, prefixedP: 0 },
  sharedCardIdCount: 0,
  duplicateOccurrenceCount: 0,
  corrections: [{ from: 'B0982', to: '0982', count: 1 }],
  keyCollisionCount: 0,
}
```

Populate counts from actual data rather than hard-coding the example values.

- [ ] **Step 5: Run script tests and commit the sync pipeline**

Run: `node --test scripts/card-master-domain.test.mjs scripts/sync-rugia-card-master.test.mjs`

Expected: PASS.

```bash
git add scripts/card-master-domain.mjs scripts/card-master-domain.test.mjs scripts/sync-rugia-card-master.mjs scripts/sync-rugia-card-master.test.mjs
git commit -m "feat: sync shared and prefixed card IDs"
```

### Task 5: Composite-Key Card Master Importer

**Files:**
- Modify: `scripts/import-card-master.mjs`
- Modify: `scripts/import-card-master.test.mjs`
- Modify: `src/data/cards/cardImport.ts`
- Modify: `src/data/cards/cardImport.test.ts`

**Interfaces:**
- Consumes: `canonicalCardIdentity`, `createCardKey`, and approved normalization from `scripts/card-master-domain.mjs`.
- Produces: `validateCardMasterImport(input): CardArtifactRecord[]` allowing shared visible IDs across distinct canonical identities.
- Produces: `planCardMasterImport(input, options?): PreparedCard[][]`, where each prepared card is `{ key, cardId, cardType, cardName, rarities }`.
- Produces: `executeCardMasterImport(input, { initializeFirestore, createKey? }): Promise<void>` that completes all validation/key collision checks before `initializeFirestore`.
- Produces: `runCardMasterImportCli(argv, dependencies?): Promise<void>` with injectable JSON reading, import execution, and logging.
- Produces: CLI `--dry-run <artifact-path>` mode that plans the import, prints canonical record and batch counts, and never initializes Firebase Admin.

Use this concrete prepared shape:

```js
/** @typedef {{key: string, cardId: string, cardType: 'character'|'event'|'case'|'partner', cardName: string, rarities: string[]}} PreparedCard */
```

- [ ] **Step 1: Write failing importer safety tests**

Assert the importer:

```js
assert.deepEqual(validateCardMasterImport([
  { cardId: '0501', cardType: 'character', cardName: '諸伏高明', rarities: ['d'] },
  { cardId: '0501', cardType: 'event', cardName: '事件 0501', rarities: ['D'] },
  { cardId: 'p001', cardType: 'partner', cardName: '江戶川柯南', rarities: ['p'] },
]), [
  { cardId: '0501', cardType: 'character', cardName: '諸伏高明', rarities: ['D'] },
  { cardId: '0501', cardType: 'event', cardName: '事件 0501', rarities: ['D'] },
  { cardId: 'P001', cardType: 'partner', cardName: '江戶川柯南', rarities: ['P'] },
]);
```

Inject `createKey: () => 'card_collision'` for two different canonical records and assert the whole plan rejects before `initializeFirestore` is called. Assert batch writes target `doc(prepared.key)` and data contains `cardId` plus only the other three allowlisted fields. Keep the existing 450-write batching and retry-safe partial-failure assertions.

Call `runCardMasterImportCli(['--dry-run', fixturePath], dependencies)` and assert the log is `records=<count>, batches=<count>, keyCollisions=0`; inject an `executeImport` dependency that throws and assert dry-run never calls it.

- [ ] **Step 2: Run importer tests and verify failure**

Run: `node --test scripts/import-card-master.test.mjs`

Run: `npm test -- src/data/cards/cardImport.test.ts`

Expected: FAIL because import currently keys and conflicts by visible `cardId` and rejects `P001`.

- [ ] **Step 3: Implement pre-Admin composite preparation and writes**

Use this preparation order:

```js
export function planCardMasterImport(input, { createKey = createCardKey } = {}) {
  const cards = validateCardMasterImport(input);
  const prepared = cards.map((card) => ({ key: createKey(card), ...card }));
  assertNoKeyCollisions(prepared);
  return chunk(prepared, MAX_WRITES_PER_BATCH);
}
```

Then write:

```js
batch.set(db.collection('cards').doc(key), { cardId, cardType, cardName, rarities });
```

Do not call a delete API. Port the same whitelist, normalization, composite aggregation, and shared-ID behavior to the browser-side `validateCardImport`; it returns artifact records without keys.

Parse CLI arguments through the exported runner:

```js
export async function runCardMasterImportCli(
  argv,
  { readJson = async (path) => JSON.parse(await readFile(path, 'utf8')), executeImport = executeCardMasterImport, log = console.log } = {},
) {
  const dryRun = argv[0] === '--dry-run';
  const inputPath = dryRun ? argv[1] : argv[0];
  if (!inputPath) throw new Error('Usage: npm run import:cards -- [--dry-run] <input-file>');
  const input = await readJson(inputPath);
  if (!dryRun) return executeImport(input);
  const batches = planCardMasterImport(input);
  const recordCount = batches.reduce((count, batch) => count + batch.length, 0);
  log(`records=${recordCount}, batches=${batches.length}, keyCollisions=0`);
}
```

Keep the existing `fileURLToPath(import.meta.url)` entrypoint guard and call `runCardMasterImportCli(process.argv.slice(2))` inside it, so importing the module in tests never executes the CLI.

- [ ] **Step 4: Run importer tests and commit**

Run: `node --test scripts/import-card-master.test.mjs`

Run: `npm test -- src/data/cards/cardImport.test.ts`

Expected: PASS, including collision-before-initialization and >500-record batching coverage.

```bash
git add scripts/import-card-master.mjs scripts/import-card-master.test.mjs src/data/cards/cardImport.ts src/data/cards/cardImport.test.ts
git commit -m "feat: import card master with composite keys"
```

### Task 6: Sell Flow for Prefixed and Shared IDs

**Files:**
- Modify: `src/features/sell/sellForm.ts`
- Modify: `src/features/sell/sellForm.test.ts`
- Modify: `src/components/CardMetadataSelector.tsx`
- Modify: `src/components/CardMetadataSelector.test.tsx`
- Modify: `src/features/sell/SellPage.tsx`
- Modify: `src/features/sell/SellPage.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `normalizeCardId`, `isCompleteCardId`, `getCardsForMetadata`, and `hasKnownCardMetadata` from prior tasks.
- Produces: an ID text input with `maxLength={4}`, `autoCapitalize="characters"`, `spellCheck={false}`, and no numeric-only `inputMode`.
- Produces: `normalizeSellForm` returning uppercase `cardId` and NFC-trimmed `cardName`.
- Preserves: Listing creation payload with visible snapshots only and validation before image upload.

- [ ] **Step 1: Write failing sell form and component tests**

Add form assertions that `p001` normalizes to `P001`, `P001` passes, and `P01`/`B0982` show `卡片 ID 請輸入 4 位數字，或 P 加 3 位數字。`.

Render a Card Master containing:

```ts
{ key: 'card_partner', cardId: 'P001', cardType: 'partner', cardName: '江戶川柯南', rarities: ['P'] }
```

Assert the seller can choose/type `P001`, that the input exposes the mobile-safe attributes, and that submission calls `uploadListingImages` only after `hasKnownCardMetadata` succeeds. Assert the resulting Listing has `cardId: 'P001'` and no `key` or `cardKey` property.

- [ ] **Step 2: Run sell tests and verify failure**

Run: `npm test -- src/features/sell/sellForm.test.ts src/components/CardMetadataSelector.test.tsx src/features/sell/SellPage.test.tsx`

Expected: FAIL because the form only validates numeric IDs and the current selector renders a select-only ID control.

- [ ] **Step 3: Implement normalized ID entry and exact Card Master validation**

Render the ID control as a text input backed by a datalist of the already narrowed Cards:

```tsx
<input
  aria-label="卡片 ID"
  autoCapitalize="characters"
  list="card-metadata-id-options"
  maxLength={4}
  spellCheck={false}
  value={value.cardId}
  onChange={(event) => updateCardId(normalizeCardIdQuery(event.target.value))}
/>
<datalist id="card-metadata-id-options">
  {cardOptions.map((card) => <option key={card.key} value={card.cardId} />)}
</datalist>
```

Keep rarity disabled until an exact known name exists. Keep ID disabled until rarity exists. `SellPage.submit` must validate the normalized visible combination before it calls `createListingId` or uploads files.

Reuse the existing glassmorphic form-control styles for the new ID input. Verify the visible label remains associated through the wrapping `<label>`, keyboard focus uses the existing high-contrast focus ring, and the control remains at least 44 CSS pixels tall without horizontal overflow at a 375-pixel viewport.

- [ ] **Step 4: Run sell tests and commit**

Run: `npm test -- src/features/sell/sellForm.test.ts src/components/CardMetadataSelector.test.tsx src/features/sell/SellPage.test.tsx`

Expected: PASS.

```bash
git add src/features/sell/sellForm.ts src/features/sell/sellForm.test.ts src/components/CardMetadataSelector.tsx src/components/CardMetadataSelector.test.tsx src/features/sell/SellPage.tsx src/features/sell/SellPage.test.tsx src/styles.css
git commit -m "feat: sell cards with prefixed visible IDs"
```

### Task 7: Marketplace Search and Ambiguity-Safe Legacy Listings

**Files:**
- Create: `src/domain/listingMetadata.ts`
- Create: `src/domain/listingMetadata.test.ts`
- Modify: `src/listingFilters.ts`
- Modify: `src/listingFilters.test.ts`
- Modify: `src/components/CardIdSearchField.tsx`
- Modify: `src/components/CardIdSearchField.test.tsx`
- Modify: `src/features/marketplace/marketplaceCatalog.ts`
- Modify: `src/features/marketplace/marketplaceCatalog.test.ts`
- Modify: `src/features/marketplace/MarketplacePage.tsx`
- Modify: `src/features/marketplace/MarketplacePage.test.tsx`
- Modify: `src/features/listings/ListingMetadata.tsx`
- Modify: `src/features/listings/ListingMetadata.test.tsx`
- Modify: `src/features/listings/ListingPage.tsx`
- Modify: `src/features/listings/ListingPage.test.tsx`
- Modify: `src/features/listings/ListingEditPage.tsx`
- Modify: `src/features/listings/ListingEditPage.test.tsx`
- Modify: `src/features/dashboard/DashboardPage.tsx`
- Modify: `src/features/dashboard/DashboardPage.test.tsx`

**Interfaces:**
- Consumes: `normalizeCardIdQuery` and `validateCardIdQuery` from Task 1.
- Produces: `findCardsByVisibleId(cards, cardId): Card[]` and `resolveListingMetadata(listing, cards): ResolvedListingMetadata`.
- Produces: `ResolvedListingMetadata.resolution` with exact values `'snapshot' | 'legacy-character' | 'card-master' | 'ambiguous' | 'missing'`.
- Produces: Marketplace filtering against normalized Listing `cardId` snapshots using prefix match below four characters and exact match at four characters.

Use this concrete resolver result:

```ts
export interface ResolvedListingMetadata {
  cardType?: CardType;
  cardName: string;
  rarity: string;
  cardId: string;
  resolution: 'snapshot' | 'legacy-character' | 'card-master' | 'ambiguous' | 'missing';
}
```

- [ ] **Step 1: Write failing partial-search and legacy ambiguity tests**

Assert:

```ts
expect(filterListings(listings, base({ cardIdQuery: 'p' }))).toEqual([p001Listing, p082Listing]);
expect(filterListings(listings, base({ cardIdQuery: 'P00' }))).toEqual([p001Listing]);
expect(filterListings(listings, base({ cardIdQuery: 'P001' }))).toEqual([p001Listing]);
expect(validateCardIdQuery('P0001')).toBe('卡片 ID 請輸入 4 位數字，或 P 加 3 位數字。');
```

Create a card-ID-only legacy Listing and two Card Master records sharing its visible `0501`. Assert resolution returns `{ resolution: 'ambiguous', cardName: '卡片資料不明確', cardType: undefined }`. With exactly one candidate, assert the resolver uses that Card. With complete Listing snapshots, assert snapshots win even when multiple Card Master records share the ID.

In Listing page tests, assert an ambiguous legacy Listing displays `卡片資料不明確` and no subscription button. In edit tests, assert immutable metadata stays ambiguous and saving mutable fields does not write guessed card metadata.

In Marketplace component tests, enter an invalid query and assert `loadListings` and `loadCards` remain at their single initial calls; validation and filtering must not issue an extra Firestore read.

- [ ] **Step 2: Run focused marketplace/listing tests and verify failure**

Run: `npm test -- src/domain/listingMetadata.test.ts src/listingFilters.test.ts src/components/CardIdSearchField.test.tsx src/features/marketplace/marketplaceCatalog.test.ts src/features/marketplace/MarketplacePage.test.tsx src/features/listings/ListingMetadata.test.tsx src/features/listings/ListingPage.test.tsx src/features/listings/ListingEditPage.test.tsx src/features/dashboard/DashboardPage.test.tsx`

Expected: FAIL because P-prefix queries are rejected and pages currently use `.find()` by the old `Card.id`.

- [ ] **Step 3: Implement one shared metadata resolver**

```ts
export function findCardsByVisibleId(cards: readonly Card[], cardId: string): Card[] {
  const normalized = normalizeCardId(cardId);
  return cards.filter((card) => card.cardId === normalized);
}

export function resolveListingMetadata(listing: Listing, cards: readonly Card[]): ResolvedListingMetadata {
  if (isCardType(listing.cardType) && hasText(listing.cardName)) return fromSnapshot(listing);
  if (hasText(listing.characterName)) return fromLegacyCharacter(listing);
  const candidates = findCardsByVisibleId(cards, listing.cardId);
  if (candidates.length === 1) return fromCardMaster(listing, candidates[0]);
  if (candidates.length > 1) return ambiguousMetadata(listing.cardId, listing.rarity);
  return missingMetadata(listing.cardId, listing.rarity);
}
```

Implement each named helper in the same file with concrete fallback labels: ambiguous uses `卡片資料不明確`; missing uses `未提供卡片名稱`; missing rarity uses `未提供稀有度`. Do not sort candidates and choose index zero.

- [ ] **Step 4: Wire normalized search and the shared resolver into every page**

`CardIdSearchField` must uppercase through `normalizeCardIdQuery`, keep `type="text"` and `maxLength={4}`, set `autoCapitalize="characters"` and `spellCheck={false}`, and remove `inputMode="numeric"`.

Normalize once in `filterListings`; if the query is valid, use `startsWith` for lengths 1–3 and equality for length 4. Pass full Card arrays to `ListingMetadata` rather than preselecting one Card with `.find()`. Marketplace may combine deduplicated Firestore cards with development fallback cards before resolution, but Firestore candidates take precedence when any exist.

Keep the input state immediate, but defer local catalog filtering so mobile typing remains responsive:

```tsx
const deferredFilters = useDeferredValue(filters);
const deferredHasExactKnownCardName = Boolean(deferredFilters.cardType
  && hasKnownCardName(cards, deferredFilters.cardType, deferredFilters.cardName ?? ''));
const visibleListings = useMemo(() => filterListings(listings, {
  ...deferredFilters,
  cardName: deferredHasExactKnownCardName ? deferredFilters.cardName : '',
}), [deferredFilters, deferredHasExactKnownCardName, listings]);
```

Only render `CharacterSubscriptionControl` when resolved metadata is a known character and `resolution !== 'ambiguous'`.

- [ ] **Step 5: Run focused tests and commit**

Run: `npm test -- src/domain/listingMetadata.test.ts src/listingFilters.test.ts src/components/CardIdSearchField.test.tsx src/features/marketplace/marketplaceCatalog.test.ts src/features/marketplace/MarketplacePage.test.tsx src/features/listings/ListingMetadata.test.tsx src/features/listings/ListingPage.test.tsx src/features/listings/ListingEditPage.test.tsx src/features/dashboard/DashboardPage.test.tsx`

Expected: PASS.

```bash
git add src/domain/listingMetadata.ts src/domain/listingMetadata.test.ts src/listingFilters.ts src/listingFilters.test.ts src/components/CardIdSearchField.tsx src/components/CardIdSearchField.test.tsx src/features/marketplace src/features/listings src/features/dashboard/DashboardPage.tsx src/features/dashboard/DashboardPage.test.tsx
git commit -m "feat: resolve shared card IDs safely in listings"
```

### Task 8: Notifications, Rules, and Operator Documentation

**Files:**
- Modify: `functions/src/domain.test.ts`
- Modify: `functions/src/listingEvents.test.ts`
- Modify: `functions/src/dailyDigest.test.ts`
- Modify: `functions/src/discordClient.test.ts`
- Modify: `src/rules/firebaseRules.test.ts`
- Modify: `docs/card-master-import.md`
- Modify: `docs/card-master.example.json`
- Modify: `docs/multi-card-type-acceptance.md`

**Interfaces:**
- Consumes: Listings continue emitting visible `cardId` strings through existing notification event interfaces.
- Verifies: Email and Discord render `P001` unchanged and do not depend on Card Master keys.
- Verifies: public clients can read `cards/{cardKey}` but cannot write it; Listing ownership rules remain unchanged.
- Documents: no-delete migration, deterministic key format, allowed JSON fields, controlled correction, report gate, and retry-safe batching.

- [ ] **Step 1: Add failing cross-boundary and rules assertions**

Change representative notification fixtures from legacy placeholder `CT-P01-001` to approved `P001`, and assert plain text email, HTML email, and Discord payloads contain `卡片 ID：P001`.

In emulator tests, seed this Admin-owned document:

```ts
await environment.withSecurityRulesDisabled(async (context) => {
  await setDoc(doc(context.firestore(), 'cards', 'card_test_hash'), {
    cardId: 'P001', cardType: 'partner', cardName: '江戶川柯南', rarities: ['P'],
  });
});
```

Assert an unauthenticated client can read it and both unauthenticated and authenticated clients cannot create/update/delete Card Master documents.

- [ ] **Step 2: Run functions and rules tests**

Run: `npm run test:functions`

Expected: PASS after fixture updates because notification code treats IDs as bounded strings; any failure identifies an accidental format assumption to remove without changing notification semantics.

Run: `npm run test:rules`

Expected: PASS; no Firestore rule relaxation is required.

- [ ] **Step 3: Update operator documentation and the example artifact**

Document this exact new example:

```json
[
  {"cardId":"0501","cardType":"character","cardName":"諸伏高明","rarities":["D"]},
  {"cardId":"0501","cardType":"event","cardName":"事件 0501","rarities":["D"]},
  {"cardId":"P001","cardType":"partner","cardName":"江戶川柯南","rarities":["P"]}
]
```

State that the importer writes each record to `cards/{card_<full-sha256>}`, retains `cardId` in document data, does not delete `cards/{cardId}` legacy documents, and requires a report with zero unknown IDs and zero key collisions. Keep the production command visibly prohibited until the user approves the exact generated artifact and command.

- [ ] **Step 4: Run documentation allowlist checks and commit**

Run: `rg -n "officialImage|effect|牌效|PR226|cards/\{cardId\}|四個十進位" docs/card-master-import.md docs/card-master.example.json docs/multi-card-type-acceptance.md`

Expected: authorized-field warnings remain, while obsolete claims that `cardId` is the document ID or only four numeric digits are absent.

```bash
git add functions/src/domain.test.ts functions/src/listingEvents.test.ts functions/src/dailyDigest.test.ts functions/src/discordClient.test.ts src/rules/firebaseRules.test.ts docs/card-master-import.md docs/card-master.example.json docs/multi-card-type-acceptance.md
git commit -m "docs: document composite card master migration"
```

### Task 9: Full Verification and Production Candidate Audit

**Files:**
- Verify only: no repository file should change during this task.
- Generate outside repository: `/tmp/conan-card-master-composite.json`

**Interfaces:**
- Consumes: all application, script, functions, and rules work from Tasks 1–8.
- Produces: a locally audited candidate JSON and captured report; it does not import, deploy, delete, commit generated data, or push.

- [ ] **Step 1: Run all repository test suites**

Run: `npm test`

Expected: PASS for all `src/` unit and component tests.

Run: `node --test scripts/card-master-domain.test.mjs scripts/sync-rugia-card-master.test.mjs scripts/import-card-master.test.mjs scripts/glass-theme.test.mjs`

Expected: PASS for all script tests.

Run: `npm run test:functions`

Expected: PASS.

Run: `npm run test:rules`

Expected: PASS against Firestore and Storage emulators.

- [ ] **Step 2: Build both deployable TypeScript targets**

Run: `npm run build`

Expected: PASS and emit the Vite production bundle.

Run: `npm run build:functions`

Expected: PASS and emit the Cloud Functions build.

- [ ] **Step 3: Generate and inspect a real Rugia candidate without importing it**

Run: `npm run sync:cards -- /tmp/conan-card-master-composite.json`

Expected: 23 versions processed; only numeric and `P`-prefixed approved IDs; one reported `B0982 -> 0982` correction; zero unknown IDs; zero key collisions; shared visible IDs reported without failure.

Run: `node scripts/import-card-master.mjs --dry-run /tmp/conan-card-master-composite.json`

Expected: validation succeeds, prints canonical record and batch counts with `keyCollisions=0`, and does not initialize Admin.

- [ ] **Step 4: Verify repository cleanliness and migration guardrails**

Run: `git diff --check`

Expected: no whitespace errors.

Run: `git status --short`

Expected: no tracked changes from verification; pre-existing user-owned untracked files remain untouched. Confirm no command in this task invoked production import, Firebase deploy, GitHub Pages deploy, deletion, or push.
