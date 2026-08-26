# Task 4 report — generic Listing snapshots and validated sell flow

## Scope delivered

- Added Listing snapshot metadata for `cardType`, `cardName`, `rarity`, and four-digit `cardId` validation on new Listings.
- Kept `characterName` solely as the existing character-notification compatibility snapshot:
  - character Listings require it and require it to equal `cardName`;
  - non-character Listings reject it;
  - Firestore writes omit it for every non-character Listing.
- Added legacy Listing reads: when both normalized fields are absent, `characterName` becomes the character `cardType` and `cardName`. A partially normalized document does not receive that fallback. Legacy reads retain their existing non-four-digit IDs.
- Replaced Sell form `characterName` state with Task 2's `cardType` and `cardName` metadata contract, while continuing to use `CardMetadataSelector` and `hasKnownCardMetadata`.
- Submit verifies the exact four-field Card Master combination before `uploadListingImages`. A mismatch remains in the established `field-error` alert region and uses the specified message:
  `資料庫找不到這組卡片類型、卡片名稱、稀有度與 ID，請確認後再試。`
- Preserved the existing price, quantity, images, fees, shipping, note, and success/error behavior. No CSS or Task 5–7 marketplace/detail/notification work was added.

## Test-first evidence

1. RED: after adding snapshot, legacy-converter, generic-form, and SellPage submission tests, ran:

   ```sh
   npm test -- src/domain/models/domainModels.test.ts src/data/firestore/converters.test.ts src/features/sell/sellForm.test.ts src/features/sell/SellPage.test.tsx
   ```

   Exit 1; 12 tests failed. The relevant failures were missing generic Listing metadata, legacy conversion, generic sell state, and the pre-upload path. Test-only setup was then corrected to use a stable profile-loader callback so component tests did not create a React update loop.

2. GREEN: after the minimal implementation, the same focused command passed: 4 files, 45 tests.

3. Additional legacy-ID RED/GREEN: changed the legacy Listing fixture to `CT-P01-001` and ran:

   ```sh
   npm test -- src/data/firestore/converters.test.ts
   ```

   RED failed with `Listing requires a four-digit cardId.`; after limiting the four-digit requirement to new Listings, GREEN passed: 1 file, 16 tests.

## Verification evidence

- Focused Task 4 suite: 4 files, 45 tests passed (before the final legacy-ID regression; its focused converter test passed afterward).
- Relevant app/listing tests with the root `.env` loaded and `NODE_OPTIONS=--no-experimental-webstorage`: 4 files, 17 tests passed.
- Full root suite with root `.env` loaded and `NODE_OPTIONS=--no-experimental-webstorage`: 36 files, 150 tests passed.
- Production build with the same `NODE_OPTIONS`: `tsc -b && vite build` passed. Vite reported its pre-existing bundle-size advisory for a 810.22 kB JavaScript chunk; it did not fail the build.
- `git diff --check` passed with no whitespace errors.

## Self-review

- `listingConverter.toFirestore` contains only allowlisted snapshot fields and conditionally adds `characterName`; an event Listing regression explicitly asserts the field is absent.
- `listingConverter.fromFirestore` tests both new character metadata and a characterName-only legacy document. The fallback condition checks the absence of both normalized fields, so partial normalized data is not silently repaired from `characterName`.
- The SellPage regression exercises event and character submissions with valid files/pricing, verifies their resulting Listing snapshots, and verifies invalid metadata reaches the alert without invoking either upload or Listing creation.
- UI review: retained the established glassmorphic `CardMetadataSelector` and high-contrast `.field-error` alert rather than introducing new visual treatment. All controls keep their existing labels and required semantics.

## Concerns / follow-up

- `Listing.cardType` and `Listing.cardName` remain optional in TypeScript strictly to represent old documents during compatibility reads; `validateListing` requires them for every new write. Future Task 5/6 presentation code must retain its documented fallback path for truly old data.
- This task deliberately does not alter Firestore rules, Marketplace filtering, display/detail pages, or notification Functions; those are Tasks 5–7.
