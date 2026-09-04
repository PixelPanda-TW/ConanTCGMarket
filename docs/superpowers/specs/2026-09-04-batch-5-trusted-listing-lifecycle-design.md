# Batch 5 Trusted Listing Lifecycle and Complete Sales History Design

## Purpose

Batch 5 makes listing inventory and sales a single trusted lifecycle and turns
the Dashboard's aggregate-only sales data into a complete, durable history.
It preserves the product decisions that sold-out listings remain visible to
their seller and that the complete sales history is still required.

The current browser transaction usually updates a Listing and creates a Sale
together, but Firestore Rules authorize the two writes independently and do not
prove their arithmetic relationship. An owner can also directly rewrite Listing
identity, inventory, or status fields, and the Dashboard never renders individual
Sale records. UI presence is therefore not evidence of a complete or trustworthy
workflow.

## Product decisions

### Inventory changes

- The only operation that reduces `remainingQuantity` is recording a Sale.
- Listing edit may change photos, listing price, sleeve/MyShip options and fees,
  and note. It may not change card identity, seller, original quantity,
  remaining quantity, status, or creation time.
- Restocking is not silently inferred from editing `remainingQuantity`. A future
  explicit inventory-adjustment workflow can add provenance if it is needed.
- `status` is server-derived: positive remaining quantity is `active`; zero is
  `sold_out`.

### Sold-out visibility

- Public Marketplace queries continue to exclude sold-out Listings.
- The owner can read sold-out Listings in Dashboard and by direct Listing route.
- Sold-out items appear in a dedicated Dashboard section and retain their full
  listing metadata.
- Sold-out Listings are read-only. They do not show edit, sale, contact-reveal,
  or destructive controls.

### Deletion

- An active Listing with no Sale records may be deleted by its active owner.
- Any Listing with one or more Sale records cannot be deleted. This includes
  partially sold and sold-out Listings.
- A denied deletion changes neither Firestore nor Storage.
- A successful trusted deletion returns the canonical stored image URLs. Only
  after that response may the client make a best-effort Storage cleanup.
- Storage-cleanup failure does not resurrect the already deleted Firestore
  Listing; the UI reports that the listing was removed but cleanup needs retry.

### Complete sales history

The Dashboard shows every readable Sale, newest first. Equal timestamps use Sale
ID descending as a deterministic tie-breaker. Every row shows:

- sale date and time in `Asia/Taipei`;
- card name, type, rarity, and visible card ID when available;
- quantity;
- listing unit price at the time of sale;
- actual sold unit price;
- line total (`quantity * soldUnitPrice`);
- the associated Listing link when that Listing still exists.

The existing totals remain derived from the same loaded Sale records. Empty,
loading, malformed/partial metadata, and load-error states are explicit. A
single malformed Sale document must fail the history load instead of silently
changing totals.

This batch loads the seller's full current history as one owner query, matching
the present repository contract. Cursor pagination and export are deferred until
production volume demonstrates the need; "complete" here means no arbitrary
recent-record limit and no aggregate-only presentation.

## Canonical Sale contract

New trusted sales use this immutable logical shape:

```ts
interface Sale {
  id: string;
  listingId: string;
  sellerId: string;
  cardId: string;
  cardType?: CardType;
  cardName?: string;
  rarity?: string;
  quantity: number;
  listingUnitPrice: number;
  soldUnitPrice: number;
  soldAt: Date;
}
```

Current normalized Listings produce all three snapshot fields. Recognized legacy
Sales without those fields remain readable. A legacy Sale may resolve display
metadata from its retained Listing and Card Master; ambiguous or unavailable
metadata is labeled honestly rather than guessed. Writes always use the new
normalized shape.

Sale documents are immutable. No browser or callable update/delete capability is
introduced. Corrections/reversals need a separately designed append-only audit
model and are outside this batch.

## Trusted callable workflows

All callables require Firebase Authentication and the exact canonical active
account decision established in Batch 3. Missing `accountAccess/{uid}` remains
active for compatibility; suspended, malformed, or unavailable access fails
closed. Request payloads reject unknown fields.

### `recordListingSale`

Input:

```ts
{ listingId: string; quantity: number; soldUnitPrice: number }
```

Within one Admin Firestore transaction it:

1. reads and strictly validates the Listing;
2. verifies the caller owns it and it is active;
3. validates integer quantity and positive finite unit price;
4. rejects overselling and zero inventory;
5. creates a random Sale document with Listing identity snapshots;
6. decrements inventory and derives the resulting status;
7. uses one server-owned timestamp for `soldAt` and Listing `updatedAt`;
8. returns the strict Sale plus the resulting Listing availability.

The client adopts the response and refreshes Dashboard data. Duplicate clicks
are prevented while a request is pending. This callable does not attempt an
optimistic local decrement.

### `updateSellerListing`

Input contains exactly the Listing ID, expected previous `updatedAt`, and the
editable fields. The server verifies owner and active status, compares the
expected timestamp, validates the resulting Listing, writes only the editable
fields plus a server timestamp, and returns the updated Listing. A stale form
receives `aborted` and must reload instead of overwriting a concurrent Sale.

Sold-out Listings reject updates because their historical sales state is final
in this workflow.

### `deleteUnsoldListing`

Input:

```ts
{ listingId: string; expectedUpdatedAt: string }
```

The transaction verifies active owner, active Listing, matching version,
`remainingQuantity === originalQuantity`, and no Sale whose `listingId` matches.
It then deletes the Listing and returns its stored image URLs. A conflict or
existing Sale returns a stable error without URLs and without mutation.

Firestore transaction query support is used for the existence check. The query
is bounded to one result because only existence matters.

## Frontend integration

Repository functions become strict callable adapters. They validate exact
responses and reject malformed dates, fields, snapshots, and availability. They
never write `sales` and never update/delete existing `listings` directly.

`ListingEditPage` removes the quantity input. It clears stale save responses when
the Listing ID or UID changes and handles conflict/reload separately from generic
failure. Delete is available only when the loaded Listing is active and appears
unsold; the server remains authoritative.

`ListingPage` and Dashboard hide mutation controls for sold-out Listings.
Dashboard renders active and sold-out inventory plus the complete Sale history.
Suspended sellers retain read-only access to all three areas and totals.

## Firestore Rules

- `listings` create remains an active authenticated browser operation, but Rules
  validate an exact canonical shape, owner, positive inventory, equal original
  and remaining quantity, active status, timestamps, and supported optional
  fields.
- Browser update/delete of `listings` is denied. Trusted callables use Admin SDK.
- Owner reads remain allowed for both active and sold-out Listings.
- Browser create/update/delete of `sales` is denied. Owner read remains allowed
  for active and suspended account history.
- All unrelated Card Master, profile/contact, subscription, and operational
  collection rules remain unchanged.

## Compatibility and migration

No production data is mutated in Batch 5. Existing legacy Sale documents remain
readable through an explicit legacy converter branch. New writes always contain
snapshot fields.

A dry-run-first audit tool reports:

- total Sales;
- normalized versus recognized legacy records;
- legacy records resolvable from their Listing;
- missing Listing, ambiguous metadata, malformed Sale, and snapshot conflicts.

Optional apply mode can backfill only unambiguous legacy records. It requires an
explicit project, a non-existing JSON backup path, and `--apply`; it aborts on
malformed/conflicting data and verifies bounded writes. The tool and exact
rollout order are prepared and tested but apply/deploy are not authorized here.

Release order is Functions, legacy Sale audit/backfill when separately approved,
Firestore Rules, then frontend. Tightening Rules before Functions would strand
existing browser mutations; deploying frontend before Rules would expose a
mixed trust path.

## Error and concurrency behavior

- Callable errors use stable Firebase codes while UI text remains user-oriented.
- `unauthenticated`, suspended/invalid access, permission denial, not found,
  invalid argument, failed precondition, stale `aborted`, and unavailable are
  distinct internally.
- A Sale and inventory update either both commit or neither commits.
- Two concurrent Sale requests cannot oversell because both read and write the
  Listing in transactions.
- A concurrent edit cannot overwrite the inventory/status timestamp because it
  sends an expected version and cannot write those fields.
- Stale async responses may not update a different Listing or user's Dashboard.

## Testing strategy

### Pure Functions tests

- exact input validation and unknown-field rejection;
- account state, ownership, listing state, value boundaries, and oversell;
- normalized snapshot construction and legacy rejection for new writes;
- partial/sold-out arithmetic and concurrent-version decisions;
- update allowlist and derived immutable fields;
- deletion with inventory/Sale/version conflicts;
- contact values never enter Sale or responses.

### Adapter and component tests

- clients call Functions and perform no direct lifecycle writes;
- response parsing is strict;
- edit excludes inventory and handles stale conflicts;
- sold-out pages are visible but read-only;
- history ordering, fields, totals, empty/loading/error/legacy metadata states;
- suspended sellers retain history without actions.

### Rules Emulator and E2E

- owners cannot directly create Sales or update/delete Listings;
- strict new Listing create remains functional;
- callable partial and sold-out sales update exact records atomically;
- oversell and non-owner operations change nothing;
- full history persists and sold-out Listing remains owner-visible after reload;
- Marketplace and anonymous detail do not expose sold-out Listings;
- unsold deletion succeeds; any sold Listing deletion is rejected.

## Out of scope

- Payment, checkout, buyer identity, fulfillment, refunds, reversals, or disputes.
- Inventory restocking/withdrawal adjustments without a Sale.
- Editing or deleting Sale records.
- Pagination, date filters, CSV/accounting export, tax calculations, or charts.
- Production migration, deployment, or any production mutation.
- Admin moderation, report tickets, seller subscriptions, and Card Master admin.

## Acceptance criteria

1. Only trusted Functions can update/delete existing Listings or create Sales.
2. Every Sale and inventory/status change commits atomically and cannot oversell.
3. New Sales contain immutable card identity and price snapshots.
4. Existing recognized legacy Sales remain readable without guessed metadata.
5. Dashboard renders every loaded Sale with all defined history fields and totals.
6. Sold-out Listings remain visible to their owner and are absent publicly.
7. Sold-out/history-bearing Listings cannot be deleted or mutated.
8. Unsold active Listings can be safely edited and deleted with stale-write checks.
9. Suspended sellers retain read-only inventory, sold-out, totals, and history.
10. Strict Rules and E2E tests prove direct-browser bypasses fail.
11. A dry-run audit/backfill path is tested and documented without being run on production.
12. No production migration, deployment, or data mutation occurs in this batch.
