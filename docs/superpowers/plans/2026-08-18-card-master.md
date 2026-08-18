# Card Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Firestore-backed card master with development seed data, Chinese/Japanese search, and a reusable autocomplete card selector.

**Architecture:** Keep the existing `Card` model and converter as the data contract. The card repository loads public card master documents through the converter and applies normalized substring matching across `nameZh` and `nameJa` in a small client-side result set. A reusable selector owns query state and selection display, while a lightweight `/cards` route makes the milestone behavior directly testable before the selector is wired into `/sell`.

**Tech Stack:** React, TypeScript, Firebase Firestore, Vitest, Vite.

**Spec:** `mvp design spec.md`, Milestone 4 in `docs/milestones.md`

## Global Constraints

- Card records contain only `id`, optional `nameZh`, optional `nameJa`, and `rarity`.
- Card master data is public-read and does not contain official card images or effect text.
- Listing creation is not included; the selector must be reusable by the next milestone.
- GitHub Pages must continue to work under the `/ConanTCGMarket/` base path and hash routes.
- Search must match either Chinese or Japanese names and must not allow a free-form listing card name.

---

### Task 1: Card repository and development seed data

**Files:**
- Create: `src/data/firestore/repositories/cardRepository.ts`
- Create: `src/data/firestore/repositories/cardRepository.test.ts`
- Create: `src/data/cards/developmentCards.ts`
- Modify: `src/data/firestore/repositories/index.ts`

**Interfaces:**
- `listCards(): Promise<Card[]>`
- `searchCards(cards: Card[], query: string): Card[]`
- `developmentCards: readonly Card[]`

**Steps:**
- [x] Write repository and search tests for converter usage, card collection path, Chinese/Japanese matching, rarity preservation, and empty queries.
- [x] Run focused tests and confirm they fail before the repository/search implementation exists.
- [x] Implement the repository, normalized matching, and a small seed dataset containing multiple `諸伏` cards with different rarities.
- [x] Keep the seed data free of images and effect text.
- [x] Run focused tests, full tests, and build.
- [x] Commit the repository and seed data.

### Task 2: Card selector and card master route

**Files:**
- Create: `src/features/cards/CardSelector.tsx`
- Create: `src/features/cards/CardSelector.test.ts`
- Create: `src/features/cards/CardMasterPage.tsx`
- Modify: `src/App.tsx`
- Modify: `src/route.ts`
- Modify: `src/route.test.ts`
- Modify: `src/styles.css`

**Interfaces:**
- `CardSelector` accepts `cards`, `value: Card | null`, and `onChange(card: Card | null)`.
- The selector shows matching card names and rarities, and selecting an option stores the complete `Card` object.
- `#/cards` displays the selector using development seed data and shows the selected card.

**Steps:**
- [x] Write selector behavior tests for query filtering, card selection, and clearing the selection.
- [x] Run focused tests and confirm they fail before the selector exists.
- [x] Implement the selector and card master page with loading and error-ready structure.
- [x] Add `#/cards` hash routing without changing the default marketplace or profile route.
- [x] Add responsive styles for the selector results and selected state.
- [x] Run focused tests, full tests, build, and `git diff --check`.
- [x] Commit the selector and route.

### Task 3: Documentation and verification

**Files:**
- Modify: `docs/milestones.md`

**Steps:**
- [x] Mark Milestone 4 status and record the deliberate client-side search limitation for the small MVP seed set.
- [x] Verify the card master route, repository exports, and privacy field boundary.
- [x] Run the full test suite, production build, and `git diff --check` on the merged `main` result.
- [x] Commit and push the documentation update.

### Verification

```bash
VITE_FIREBASE_API_KEY=test VITE_FIREBASE_AUTH_DOMAIN=test.firebaseapp.com VITE_FIREBASE_PROJECT_ID=test VITE_FIREBASE_STORAGE_BUCKET=test.appspot.com VITE_FIREBASE_MESSAGING_SENDER_ID=test VITE_FIREBASE_APP_ID=test npm test
VITE_FIREBASE_API_KEY=test VITE_FIREBASE_AUTH_DOMAIN=test.firebaseapp.com VITE_FIREBASE_PROJECT_ID=test VITE_FIREBASE_STORAGE_BUCKET=test.appspot.com VITE_FIREBASE_MESSAGING_SENDER_ID=test VITE_FIREBASE_APP_ID=test npm run build
git diff --check
```
