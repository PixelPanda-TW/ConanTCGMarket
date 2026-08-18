# Listing Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a guarded `/sell` flow that selects a card, uploads 1 to 3 physical-card photos to Firebase Storage, and creates an active Firestore listing.

**Architecture:** Keep listing persistence and image storage behind separate repository/service boundaries. The sell page first requires an authenticated user and an existing seller profile, then validates a selected Card and listing fields, generates a listing ID, uploads all selected images under a seller-scoped path, and writes a listing whose `cardId` is the selected card ID. Development card seed data powers the selector until the card sync milestone is available.

**Tech Stack:** React, TypeScript, Firebase Firestore, Firebase Storage, Vitest, Testing Library, Vite.

**Spec:** `mvp design spec.md`, Milestone 5 in `docs/milestones.md`

## Global Constraints

- Only authenticated sellers with a seller profile may create listings.
- Every listing contains 1 to 3 uploaded image URLs and starts with `status = "active"`.
- New listings set `originalQuantity` and `remainingQuantity` to the entered quantity.
- Listing records store the selected card `id` as `cardId`; seller-entered card names are never persisted.
- Storage paths include the authenticated seller UID and listing ID.
- Google email is not displayed or copied into listing/profile data.
- No payment, checkout, buyer order, listing edit, or security rules implementation is included in this milestone.

---

### Task 1: Listing creation repository and Storage service

**Files:**
- Create: `src/data/firestore/repositories/listingCreationRepository.ts`
- Create: `src/data/firestore/repositories/listingCreationRepository.test.ts`
- Create: `src/data/storage/storageService.ts`
- Create: `src/data/storage/storageService.test.ts`
- Modify: `src/data/firestore/repositories/index.ts`
- Modify: `src/lib/firebase/app.ts`

**Interfaces:**
- `createListingId(): string`
- `createListing(listing: Listing): Promise<string>`
- `uploadListingImages(sellerId: string, listingId: string, files: readonly File[]): Promise<string[]>`

**Steps:**
- [ ] Write failing tests for generated listing IDs, converter-backed listing writes, image count/type validation, seller-scoped Storage paths, and returned download URLs.
- [ ] Run focused tests and confirm they fail before the new repository/service exists.
- [ ] Implement Firestore listing creation with `listingConverter` and Firebase Storage upload with sanitized file names.
- [ ] Export the new repository functions without changing existing listing query behavior.
- [ ] Run focused tests, full tests, and build.
- [ ] Commit the repository and Storage service.

### Task 2: Sell form, profile guard, and route

**Files:**
- Create: `src/features/sell/sellForm.ts`
- Create: `src/features/sell/sellForm.test.ts`
- Create: `src/features/sell/SellPage.tsx`
- Create: `src/features/sell/SellPage.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/route.ts`
- Modify: `src/route.test.ts`
- Modify: `src/features/auth/AuthStatus.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Form state contains selected `card: Card | null`, `files: File[]`, `listingPrice`, `quantity`, `hasSleeve`, `supportsMyShip`, and `note`.
- Validation requires a selected card, 1 to 3 image files, positive integer quantity, and positive price.
- `SellPage` accepts repository/service dependencies only where needed for deterministic tests; production defaults use the Firebase implementations.

**Steps:**
- [ ] Write validation tests and page tests for unauthenticated, profile-required, successful creation, and validation-error states.
- [ ] Run focused tests and confirm they fail before the sell page exists.
- [ ] Implement the form, development card selector, profile guard, image preview/remove controls, submit state, and success/error states.
- [ ] Add `#/sell` routing and a signed-in navigation link.
- [ ] Build a listing with `cardId`, uploaded URLs, quantity fields, booleans, timestamps, and `active` status only after uploads succeed.
- [ ] Add responsive styles without exposing Google email.
- [ ] Run focused tests, full tests, build, and `git diff --check`.
- [ ] Commit the sell flow.

### Task 3: Documentation and verification

**Files:**
- Modify: `docs/milestones.md`

**Steps:**
- [ ] Mark Milestone 5 status and document that Firebase Storage/Firestore rules remain a later milestone.
- [ ] Verify the `/sell` route, profile guard, listing field mapping, and seller-scoped upload path.
- [ ] Run the full test suite, production build, and `git diff --check` on merged `main`.
- [ ] Commit and push the documentation update.

### Verification

```bash
VITE_FIREBASE_API_KEY=test VITE_FIREBASE_AUTH_DOMAIN=test.firebase.com VITE_FIREBASE_PROJECT_ID=test VITE_FIREBASE_STORAGE_BUCKET=test.appspot.com VITE_FIREBASE_MESSAGING_SENDER_ID=test VITE_FIREBASE_APP_ID=test npm test
VITE_FIREBASE_API_KEY=test VITE_FIREBASE_AUTH_DOMAIN=test.firebase.com VITE_FIREBASE_PROJECT_ID=test VITE_FIREBASE_STORAGE_BUCKET=test VITE_FIREBASE_MESSAGING_SENDER_ID=test VITE_FIREBASE_APP_ID=test npm run build
git diff --check
```
