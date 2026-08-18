# Seller Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GitHub Pages-compatible `/profile` flow where authenticated sellers can create and update their public display name and contact method.

**Architecture:** Use a small hash-based route switch instead of introducing a routing dependency. Keep Firestore access in a seller profile repository, use the existing converter and domain model for validation, and keep the profile form responsible only for loading and submitting authenticated user data.

**Tech Stack:** React, TypeScript, Firebase Auth, Firestore, Vitest, Vite.

**Spec:** `mvp design spec.md`, Milestone 3 in `docs/milestones.md`

## Global Constraints

- GitHub Pages must work under the `/ConanTCGMarket/` base path.
- Public profile data contains only seller-provided display name and contact method; Google email is not a public contact method.
- Firestore paths and conversion remain outside UI components.
- Only the authenticated seller UID may load or save that seller's profile through the repository API.
- No listing creation or security-rule implementation is included in this milestone.

---

### Task 1: Seller profile repository

**Files:**
- Create: `src/data/firestore/repositories/sellerProfileRepository.ts`
- Modify: `src/data/firestore/repositories/index.ts`
- Test: `src/data/firestore/repositories/sellerProfileRepository.test.ts`

**Interfaces:**
- `getSellerProfile(uid: string): Promise<SellerProfile | null>`
- `saveSellerProfile(profile: SellerProfile): Promise<void>`

**Steps:**
- [ ] Write repository tests for the seller profile document path, converter usage, missing document handling, and save operation.
- [ ] Run the focused tests and confirm they fail because the repository does not exist.
- [ ] Implement the document reference and get/set operations using `sellerProfileConverter` and `collections.sellerProfiles`.
- [ ] Run the focused tests, then the full test suite.
- [ ] Commit the repository and tests.

### Task 2: Hash route foundation and profile form

**Files:**
- Create: `src/features/profile/SellerProfilePage.tsx`
- Create: `src/features/profile/profileForm.ts`
- Test: `src/features/profile/profileForm.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Profile form state has `displayName`, `contactType`, and `contactValue`.
- Supported contact values are `line`, `discord`, `threads`, and `facebook`.
- `/profile` is selected from `window.location.hash`; the marketplace remains the default route.

**Steps:**
- [ ] Write validation and normalization tests for required fields, supported contact types, and whitespace trimming.
- [ ] Run the focused tests and confirm they fail before the helper exists.
- [ ] Implement the profile form helper and page with loading, unauthenticated, save, and error states.
- [ ] Add hash route navigation from the auth area and a profile link for signed-in users.
- [ ] Add responsive form styles that match the existing restrained marketplace UI.
- [ ] Run focused tests, full tests, and the production build.
- [ ] Commit the route and profile UI.

### Task 3: Integration review and milestone documentation

**Files:**
- Modify: `docs/milestones.md`

**Steps:**
- [ ] Verify profile repository exports and app imports are stable.
- [ ] Update Milestone 3 status to record the implemented scope and remaining dependency on later security rules.
- [ ] Run `git diff --check`, the full test suite, and the production build.
- [ ] Commit the documentation update.

### Verification

Run from the repository root with fake Firebase environment values when local `.env` values are unavailable:

```bash
VITE_FIREBASE_API_KEY=test VITE_FIREBASE_AUTH_DOMAIN=test.firebaseapp.com VITE_FIREBASE_PROJECT_ID=test VITE_FIREBASE_STORAGE_BUCKET=test.appspot.com VITE_FIREBASE_MESSAGING_SENDER_ID=test VITE_FIREBASE_APP_ID=test npm test
VITE_FIREBASE_API_KEY=test VITE_FIREBASE_AUTH_DOMAIN=test.firebaseapp.com VITE_FIREBASE_PROJECT_ID=test VITE_FIREBASE_STORAGE_BUCKET=test.appspot.com VITE_FIREBASE_MESSAGING_SENDER_ID=test VITE_FIREBASE_APP_ID=test npm run build
git diff --check
```
