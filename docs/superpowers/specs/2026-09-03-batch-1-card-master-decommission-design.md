# Batch 1 Card Master Decommission Design

## Goal

Remove the public Card Master page and every production fallback for the retired development and legacy Card Master formats, while preserving Card Master as the canonical data source for Marketplace filtering, listing metadata resolution, and listing creation.

## Current State

Production Firestore has been independently reconciled against Rugia and now contains 1,270 canonical `cards` documents. Every document:

- uses a deterministic `card_<sha256>` document key;
- contains exactly `cardId`, `cardType`, `cardName`, and `rarities`;
- has no legacy `characterName`, `nameZh`, `nameJa`, or scalar `rarity` field;
- contains no official image, image URL, effect text, trait, or Rugia-internal source identifier.

The client nevertheless still:

- adapts legacy Card Master documents in `cardConverter`;
- merges legacy and canonical documents in `cardRepository`;
- ships five stale `developmentCards` records as Marketplace fallback data;
- exposes a public `#/cards` Card Master page and a page-only `CardSelector`;
- tests and documents those retired behaviors.

Listing snapshots are a separate compatibility boundary. Batch 1 does not remove legacy Listing resolution because existing listing rendering and later lifecycle work are handled in Batch 5.

## Chosen Approach

Use strict canonical reads and fully decommission the obsolete public surface.

Two alternatives were rejected:

1. Hiding only the route would leave incorrect fallback and compatibility behavior in production.
2. Reusing the public page as an admin page would prematurely couple Batch 1 to the account and admin authorization work in Batches 3 and 8.

## Canonical Card Contract

`cardConverter.fromFirestore` must build a `Card` only from the four canonical document fields:

```ts
{
  cardId: string;
  cardType: 'character' | 'event' | 'case' | 'partner';
  cardName: string;
  rarities: string[];
}
```

The Firestore document ID remains the in-memory `Card.key`.

The converter must not infer or adapt:

- `cardId` from the document ID;
- a default `character` type;
- `cardName` from `characterName`, `nameZh`, or `nameJa`;
- `rarities` from a scalar `rarity`.

The converter must first reject any raw document whose keys are not exactly the four canonical fields, then pass the constructed `Card` through existing `validateCard` validation. Missing, extra, or malformed fields must throw instead of silently producing a plausible card.

## Card Repository

Delete `mergeCardsByCanonicalIdentity`. Keep deterministic presentation ordering as a separate `sortCards` operation ordered by `cardId`, `cardType`, `cardName`, and `key`. `listCards`, `listCardsFromServer`, and the cache fallback return every converter-validated snapshot record in that stable order without merging records.

The controlled importer owns canonical identity aggregation, deterministic key generation, rarity union, and collision checks before writes. Client-side deduplication would hide violations of that invariant and is no longer allowed.

Server-first behavior remains unchanged:

1. read the server snapshot;
2. on server failure only, use a non-empty cache snapshot;
3. if both fail or the cache is empty, rethrow the server error.

`getCard(cardKey)` remains available for later admin and internal consumers.

## Marketplace Metadata Flow

Delete `developmentCards` and the Marketplace-only candidate wrapper. `MarketplacePage` calls:

```ts
resolveListingMetadata(listing, loadedCards)
```

Resolution precedence remains:

1. complete Listing snapshot;
2. legacy Listing `characterName` snapshot;
3. exactly one canonical Card Master candidate for the visible ID;
4. explicit ambiguous or missing metadata.

The Marketplace must never synthesize card identity from development data. A missing Card Master candidate remains visible as a data-quality state rather than being masked.

## Public Route Decommission

Remove the public `cards` route, `CardMasterPage`, and the page-only `CardSelector`. No general user receives a Card Master browsing page.

`#/cards` is a retired legacy URL. Hash canonicalization replaces it with `#`, after which the Marketplace renders. Other unknown hashes retain the existing Marketplace fallback behavior.

Card Master remains publicly readable at the Firestore layer because unauthenticated Marketplace browsing and listing-form metadata depend on it. Batch 1 removes the product page, not the application data source.

Batch 8 will create a distinct admin-only Card Master management route protected by server-verified admin authorization.

## Removed and Retained Files

Remove:

- `src/data/cards/developmentCards.ts`
- `src/data/cards/developmentCards.test.ts`
- `src/features/marketplace/marketplaceCatalog.ts`
- `src/features/marketplace/marketplaceCatalog.test.ts`
- `src/features/cards/CardMasterPage.tsx`
- `src/features/cards/CardMasterPage.test.tsx`
- `src/features/cards/CardSelector.tsx`
- `src/features/cards/CardSelector.test.tsx`
- `e2e/card-master.spec.ts`

Retain:

- `CardMetadataSelector`, used by Marketplace and listing creation;
- `cardSearch`, used by Card Master-backed application flows;
- `listingMetadata`, including legacy Listing resolution;
- the controlled Rugia synchronizer and Card Master importer;
- Firestore public-read/client-write-denied Card Master rules.

## Documentation

Update current-state documentation to say that Card Master is an internal application data source with a future admin-only management surface. Remove the public Card Master E2E route from current integration-test inventories and smoke-route expectations.

Historical dated specs and plans remain unchanged because they document the decisions that produced the legacy implementation.

## Testing Strategy

Implementation follows strict red-green-refactor cycles.

1. Route tests first prove `#/cards` canonicalizes to `#` and no longer maps to a `cards` application route.
2. Converter tests first prove each retired Card Master shape is rejected.
3. Repository tests first prove identical snapshot records are not silently merged while results remain deterministically sorted.
4. Marketplace tests first prove missing canonical metadata stays missing without a development fallback.
5. App tests prove a legacy `#/cards` visit renders Marketplace without loading the removed page.
6. E2E and smoke contracts remove public Card Master navigation and verify the retired hash reaches Marketplace.

The completed batch must pass on Node 22:

- focused red-green tests for each behavior;
- full root Vitest suite;
- script tests;
- Firestore and Storage Rules emulator tests;
- production build;
- Chromium emulator E2E suite;
- `git diff --check` and an orphan/reference scan.

## Non-Goals

Batch 1 does not:

- create the admin Card Master UI or mutation API;
- change Firestore Card Master data;
- change Card Master public-read rules;
- remove legacy Listing snapshot resolution;
- change Marketplace search semantics;
- change authentication, seller profiles, sales, notifications, reports, moderation, or appeals.

## Acceptance Criteria

1. No production code imports or references `developmentCards`.
2. No client code adapts legacy Card Master fields or document IDs.
3. No client repository merges duplicate canonical Card Master identities.
4. Marketplace metadata uses Listing snapshots and canonical Firestore cards only.
5. The public Card Master page and its page-only selector are absent from the build.
6. Visiting `#/cards` replaces the hash with `#` and renders Marketplace.
7. Card Master-backed Marketplace and listing creation behavior continues to work.
8. Current documentation no longer advertises a public Card Master page.
9. Production code, tests, and current documentation contain no orphaned references to the removed files or page implementation; `#/cards` remains only in canonical redirect code and its regression coverage.
10. All verification gates listed above pass on Node 22.
