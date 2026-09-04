# Conan TCG Marketplace MVP Milestones

This plan follows the "real data flow first" direction. The app should connect to Firebase early, keep UI code separated from data access, and validate the full MVP scenario against real Auth, Firestore, and Storage behavior.

## Milestone 0: Repo, Build, and Deploy Foundation

Status: complete.

### Deliverables

- Vite React TypeScript project.
- GitHub Pages deployment workflow.
- Basic marketplace home screen.
- Build and test commands.

### Acceptance Criteria

- `npm run build` passes.
- Pushes to `main` can trigger GitHub Pages deployment.

## Milestone 1: Firebase Project Integration

Status: account access foundation implemented. Google sign-in establishes buyer capability; a complete Seller Profile adds seller capability to the same UID. `AuthProvider` combines Firebase Auth with a live, own-account `accountAccess/{uid}` listener. Missing access documents remain active for compatibility, while suspended or unavailable states fail closed for privileged actions.

### Goal

Connect the app to Firebase and support Google sign-in state.

### Deliverables

- Firebase config and environment variable setup.
- Firebase setup instructions in `docs/firebase-setup.md`.
- Firebase app initialization.
- Google sign-in and sign-out.
- Auth state provider.
- Live account-access state with loading, active, suspended, and unavailable outcomes.
- Neutral Google-account navigation; buyer and seller capabilities are not mutually exclusive roles.
- Current user UID available to seller-only flows.
- Guest users can still browse the marketplace.

### Acceptance Criteria

- Visitors can open the marketplace without signing in.
- Anyone who signs in with Google is an active buyer unless suspended.
- A signed-in buyer becomes a seller by completing a valid Seller Profile.
- Suspended accounts remain signed in for status/history access but cannot use privileged actions.
- Google email is not publicly displayed.

## Milestone 2: Firestore Schema and Repository Layer

### Goal

Define stable data boundaries before building more UI behavior.

Status: implemented as model, converter, and repository foundations. Firestore security rules and UI integration are covered by later milestones.

### Deliverables

- `Card` model.
- `Listing` model.
- `SellerProfile` model.
- `Sale` model.
- Firestore converters or equivalent mapping functions.
- Repository functions for active listings.
- Repository functions for seller listings.
- Repository functions for seller sales.

### Acceptance Criteria

- The app can read active listings from Firestore.
- The app can query listings owned by the signed-in seller.
- UI components do not directly hard-code Firestore collection paths.

## Milestone 3: Seller Profile

Status: repository-ready, not production-live. The `#/profile` route, protected
callable repository, create/update form, async request guards, and
component/browser coverage are in place. LINE and Discord store IDs; Facebook
and Threads store validated HTTPS personal-profile links. Contact data is split
from the public profile and disclosed only to authenticated active accounts
through an audited, rate-limited callable. Production migration and deployment
still require separate approval.

### Goal

Allow signed-in sellers to manage their public display identity and protected
contact method.

### Deliverables

- `/profile` route.
- Seller display name field.
- One preferred contact selected from LINE, Discord, Threads, and Facebook.
- LINE and Discord identifier fields with service-specific validation.
- Facebook and Threads HTTPS personal-profile URL fields with canonicalization.
- Profile create and update flow.
- Guard that sends sellers to profile setup before listing cards.

### Acceptance Criteria

- A signed-in seller can create a profile.
- A signed-in seller can update their profile.
- For an authenticated active viewer, Listing pages render LINE as an ID link,
  Discord as ID text, and Facebook/Threads as validated personal-profile links.
- Google email is not shown as a public contact method.

## Milestone 4: Minimal Card Master

Status: implemented as an internal application data source. Firestore Card Master records power Marketplace filtering, listing metadata validation, and listing creation; the retired public validation page and development seed fallback have been removed. Card Master mutations remain denied to clients until the admin-only management workflow is implemented.

### Goal

Create a searchable card master that supports listing creation without seller-entered final card names.

### Deliverables

- Public-read, client-write-denied Firestore `cards` collection.
- Canonical `cardId`, `cardType`, `cardName`, and `rarities` document fields.
- Controlled Rugia synchronization and deterministic composite-key import.
- Normalized Card Master search and metadata helpers used inside Marketplace and listing creation.
- Reusable `CardMetadataSelector` for Card Master-backed application workflows.

### Acceptance Criteria

- Searching `諸伏` can return multiple cards with different rarities.
- Seller cannot freely type the final card name for a listing.
- Listing records store immutable `cardId`, `cardType`, `cardName`, and `rarity`
  snapshots selected from Card Master.
- Each Card Master record has a canonical `cardName` and at least one rarity.

## Milestone 5: Listing Creation and Storage Upload

### Goal

Allow sellers to publish real listings with uploaded physical-card photos.

### Deliverables

- `/sell` route.
- Card selector integration.
- Image upload UI for 1 to 3 photos.
- Firebase Storage upload.
- Listing form fields for unit price, quantity, sleeve support, MyShip support, and note.
- Firestore listing creation.

### Acceptance Criteria

- Only active signed-in sellers can create listings.
- Sellers must have a profile before creating listings.
- Each listing has at least 1 photo and at most 3 photos.
- New listings set `originalQuantity` and `remainingQuantity` to the entered quantity.
- New listings start with `status = "active"`.
- Uploaded image paths include the seller UID.

## Milestone 6: Real Marketplace Search

### Goal

Replace sample listings with real Firestore-backed marketplace browsing.

### Deliverables

- Firestore-backed `/` marketplace.
- Search by Chinese or Japanese card name.
- Active listings only.
- Price sorting from low to high and high to low.
- Sleeve and MyShip filters.
- Listing cards with cover image, card name, rarity, unit price, remaining quantity, seller name, and condition tags.

### Acceptance Criteria

- Guests can search listings without signing in.
- Sold-out listings do not appear in marketplace results.
- Searching a card name shows active listings for all matching card rarities.
- Price sorting changes result order.
- Sleeve and MyShip filters exclude listings that do not match.

## Milestone 7: Listing Detail and Edit

Status: repository-ready, not production-live. Existing Listings are updated or
deleted only through trusted callable Functions; deployment has not been
authorized.

### Goal

Allow buyers to inspect a listing and allow sellers to edit only their own listings.

### Deliverables

- `/listing/:id` route.
- `/listing/:id/edit` route.
- Listing detail view with 1 to 3 photos.
- Authenticated-active-only seller contact reveal.
- Owner-only edit controls.
- Edit flow for price, conditions, note, and photos. Inventory changes only when
  a Sale is recorded.

### Acceptance Criteria

- Guests can view active listing details.
- The detail page shows card name, rarity, photos, unit price, remaining quantity, seller, contact method, sleeve support, MyShip support, and note.
- Only an active account where `listing.sellerId === currentUser.uid` can edit a listing.
- Non-owners cannot edit through UI or direct route access.
- Suspended owners may still view approved Listing data, but management links and direct edit actions are blocked.

## Milestone 8: Dashboard and Sale Records

Status: repository-ready, not production-live. Trusted transactional Sale
creation, immutable card snapshots, complete history UI, legacy read support,
and Emulator E2E coverage are implemented. The production Sale audit/backfill
and rollout remain separately authorized operations.

### Goal

Allow sellers to manage inventory, record external sales, and track cumulative sales totals.

### Deliverables

- `/dashboard` route.
- Active and sold-out listing sections.
- Dashboard metrics for active listings, sold quantity, and cumulative sold amount.
- Register sale modal.
- Trusted transactional Sale record creation with immutable card snapshots.
- Remaining quantity decrement.
- Automatic sold-out status update.

### Acceptance Criteria

- Sale quantity must satisfy `1 <= quantity <= remainingQuantity`.
- Sold unit price defaults to the listing price and can be changed.
- Creating a sale stores `listingUnitPrice` and `soldUnitPrice`.
- Creating a sale decrements `remainingQuantity`.
- When `remainingQuantity === 0`, the listing becomes `sold_out`.
- Sold-out listings disappear from the public marketplace.
- Seller dashboard still shows sold-out listings and sale history.
- Complete history shows Taipei sale time, immutable card identity, quantity,
  listing and sold unit prices, subtotal, and a Listing link when retained.
- A suspended seller retains a read-only Dashboard with active/sold-out Listings and Sale totals, with every edit and sale control removed.
- Cumulative sold amount is computed from `SUM(Sale.quantity * Sale.soldUnitPrice)`.

## Milestone 9: Firebase Security Rules

Status: repository-ready, not production-live. Emulator tests prove the trusted
lifecycle boundaries; production Rules deployment has not been authorized.

### Goal

Enforce ownership and public-read rules at the Firebase layer, not only in the frontend.

### Deliverables

- Firestore security rules.
- Storage security rules.
- Emulator tests or a documented minimum rules verification flow.
- Seller ownership validation.

### Acceptance Criteria

- Public users can read card master data.
- Public users can read active listings.
- Unauthenticated users cannot write listings, sales, or seller profiles.
- Browser clients cannot update or delete an existing Listing; trusted
  Functions enforce owner mutation rules.
- Sellers can read only their own Sale records; browser Sale writes are denied.
- Storage writes require auth and enforce seller UID in the path.
- Browser clients can read only their own `accountAccess` document and can never write it.
- Missing or canonical active account state permits existing owner mutations; suspended or malformed state denies Profile, Listing, Sale, subscription, and Listing-image mutations.
- Suspended owners retain the approved reads needed for their Listing, Sale, and subscription history.

The trusted admin suspension/restore transaction, automatic Listing hiding,
selective republishing, and appeals remain pending. Until that workflow exists,
this foundation does not mark any production account suspended.

## Milestone 10: Card Master Sync Script

### Goal

Create a repeatable card master import flow using only permitted text fields.

### Deliverables

- Card master sync script.
- Field filtering for `cardId`, `nameZh`, `nameJa`, and `rarity`.
- Explicit exclusion of card images and card effect text.
- Failure behavior that preserves the last successful card master.

### Acceptance Criteria

- Successful sync updates Firestore card master data.
- Failed sync does not delete existing card master data.
- The repository does not store official card images.
- The repository does not store official card effect text.

## Milestone 11: MVP Acceptance and Launch Cleanup

### Goal

Validate the full MVP scenario and prepare the site for early users.

### Deliverables

- End-to-end acceptance pass for the primary seller and buyer flow.
- Empty, loading, and error states for core pages.
- Final responsive layout review.
- GitHub Pages deployment verification.

### Acceptance Criteria

- Seller signs in with Google.
- Seller creates a profile.
- Seller selects `諸伏景光 CP`.
- Seller uploads physical-card photos.
- Seller publishes at NT$500 per card with quantity 5.
- Guest buyer searches `諸伏景光`.
- Guest buyer sees the listing, photos, price, remaining quantity, and seller contact method.
- Seller records a sale of 2 cards at NT$450 each.
- Listing remaining quantity becomes 3.
- Dashboard shows 2 sold cards.
- Dashboard cumulative sold amount is NT$900.
- Listing remains public while remaining quantity is greater than 0.
- After the remaining 3 cards are sold, the listing is hidden from the marketplace.
- Dashboard keeps the sold-out listing and full sale history.
