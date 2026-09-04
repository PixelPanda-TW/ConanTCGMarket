# Batch 6 Admin Card Master Management Design

## Purpose

Card Master remains an internal application data source, not a public product
page. Add one protected administration entry point so the sole current admin
can add, edit, merge, and disable incorrect cards without Firebase Console
edits. Preserve the public catalog contract and prevent a later Rugia sync from
recreating deliberately retired records.

This batch makes the workflow repository-ready only. It does not assign a
production admin claim, deploy Functions or Rules, invoke a production
callable, or mutate production Card Master data.

## Approved product decisions

- `#/admin/cards` is reachable only from an authenticated account whose Firebase
  ID token has custom claim `admin: true`.
- The page is an operational console, not a public Card Master browser.
- An admin can add the four approved Card Master values: card name, card type,
  visible card ID, and one or more rarities.
- An admin can edit a record, merge an incorrect/duplicate record into a
  canonical target, or disable it.
- Every mutation requires a bounded rationale and creates a server-owned audit
  event.
- Existing Listing and Sale snapshots are historical facts. Card Master edits,
  merges, and disables never rewrite them.
- Card effect text and official/source images are outside every request,
  response, document, form, and log in this workflow.

## Compatibility architecture

The active public catalog keeps its existing exact shape:

```ts
cards/{cardKey} = {
  cardId: string;
  cardType: 'character' | 'event' | 'case' | 'partner';
  cardName: string;
  rarities: string[];
}
```

No status, timestamps, admin UID, rationale, aliases, effect, or image fields
are added to `cards`. This avoids a flag-day migration and keeps all current
public readers and converters valid.

The deterministic key remains:

```text
card_<sha256(JSON.stringify([cardType, NFC-trimmed cardName, normalized cardId]))>
```

Two server-only collections preserve retired state and audit history:

```ts
cardMasterArchives/{retiredCardKey} = {
  cardId: string;
  cardType: CardType;
  cardName: string;
  rarities: string[];
  disposition: 'disabled' | 'superseded' | 'merged';
  replacementCardKey?: string;
  rationale: string;
  actedBy: string;
  actedAt: Timestamp;
}

cardMasterAuditLogs/{eventId} = {
  action: 'add' | 'edit' | 'disable' | 'merge';
  sourceCardKey?: string;
  targetCardKey?: string;
  before?: ApprovedCardFields;
  after?: ApprovedCardFields;
  rationale: string;
  actedBy: string;
  actedAt: Timestamp;
}
```

Archive keys suppress the same deterministic source identity during controlled
imports. An archive is not publicly readable and is never treated as a Card
Master search result.

## Authorization boundary

Every admin callable requires both:

1. a valid authenticated Firebase UID; and
2. `request.auth.token.admin === true`.

It also applies the existing canonical active-account check inside the trusted
operation. A suspended or malformed account cannot use its older admin token as
an authorization bypass; a missing access document retains the approved active
compatibility behavior.

The client-side claim check controls navigation and user guidance only. It is
not an authorization boundary. A missing, false, string, or otherwise malformed
claim is non-admin. Claim lookup failure disables only the admin surface and
does not block ordinary buyer/seller capabilities. Browser Firestore writes to
`cards`, `cardMasterArchives`, and `cardMasterAuditLogs` remain denied for every
user, including admins.

This batch does not add a UI or script that grants the custom claim. Initial
claim assignment is a separately authorized production operator action and is
documented later without executing it.

## Trusted callable API

### `listCardMasterArchives`

Admin-only read for operational context. It accepts an exact object containing
an optional bounded cursor and limit (maximum 100), sorts by `actedAt` then key,
and returns approved archive fields only. It never returns email, token, effect,
image, or unrelated audit data.

The active catalog continues to use the existing public Card repository. The
admin console combines that catalog with the protected archive page locally.

### `addCardMasterEntry`

Input is exactly:

```ts
{ cardId, cardType, cardName, rarities, rationale }
```

The Function canonicalizes the approved values, computes the key, and in one
transaction:

- rejects an existing active card;
- rejects a suppressed/archive key;
- creates the exact four-field active card; and
- creates an `add` audit event.

### `editCardMasterEntry`

Input is exactly:

```ts
{
  sourceCardKey,
  expectedFingerprint,
  cardId,
  cardType,
  cardName,
  rarities,
  rationale,
}
```

The fingerprint is a full SHA-256 over the canonical four-field source value.
It provides optimistic concurrency without changing the public document schema.

If identity is unchanged, the transaction replaces only the approved four
fields and writes an `edit` audit event. If type/name/visible ID changes, the
deterministic key changes: the transaction creates the replacement active card,
archives the old card as `superseded` with `replacementCardKey`, deletes the old
active document, and writes the audit event. A pre-existing target or stale
fingerprint aborts; no overwrite or partial move is allowed.

### `disableCardMasterEntry`

Input is exactly:

```ts
{ sourceCardKey, expectedFingerprint, rationale }
```

The transaction verifies the current source, creates a `disabled` archive,
deletes the active card, and writes the audit event. Repeating the operation is
reported as an explicit precondition failure rather than silently changing
history.

### `mergeCardMasterEntries`

Input is exactly:

```ts
{
  sourceCardKey,
  sourceExpectedFingerprint,
  targetCardKey,
  targetExpectedFingerprint,
  rationale,
}
```

Source and target must be distinct active cards. The transaction unions,
normalizes, deduplicates, and deterministically sorts their rarities into the
target; archives the complete source as `merged` with `replacementCardKey`;
deletes the source; and writes one audit event containing both before values
and the final target. It never changes the target type/name/visible ID and never
rewrites Listing, Sale, subscription, or notification-event documents.

## Validation and normalization

The trusted Functions mirror the controlled importer contract:

- card IDs normalize to exactly four digits or uppercase `P` plus three digits;
- card type is one of the four supported values;
- card name is NFC-normalized, trimmed, non-empty, and bounded;
- rarities are trimmed, uppercased, unique, non-empty, bounded, and sorted;
- rationale is trimmed, 1–500 Unicode code points;
- document keys and fingerprints have exact deterministic formats;
- every input object and stored document uses an exact allowlist;
- all malformed, extra-field, stale, conflicting, and unavailable states fail
  before mutation.

The server returns only canonical approved card fields, key, and fingerprint.
Unexpected failures map to a generic `unavailable` error without logging input
payloads or card rationale.

## Admin console UX

The existing authenticated navigation gains an `管理卡片資料` link only after
the admin claim is loaded and true. Direct-route states are explicit:

- signed out: Google sign-in guidance;
- signed in while claim loads: neutral loading state;
- non-admin or claim failure: `無權限使用管理工具` with a marketplace return;
- admin: search/list and mutation controls.

The page reuses the existing glass theme, typography, focus ring, form fields,
buttons, and responsive page shell. It provides:

- prefix search over type, name, visible ID, and rarity for loaded active cards;
- an add form with type/name/ID and repeatable rarity input;
- per-row edit, merge, and disable actions;
- a merge dialog with a searchable canonical target and explicit source/target
  summary;
- destructive confirmation for disable and merge;
- required rationale adjacent to the final submit action;
- pending guards, live status/error regions, focus return, and no color-only
  status meaning;
- active and archived sections clearly separated.

The console adopts each callable's canonical response or reloads after a
mutation. It never applies optimistic deletion or merge. A stale fingerprint
keeps the form open and instructs the admin to reload.

## Controlled import integration

The Admin importer must read `cardMasterArchives` before an apply. Planning
accepts a set of suppressed keys and reports `suppressedCount` and the exact
keys. A dry-run never writes. Apply mode refuses malformed archive records and
never recreates a suppressed key, even when the current Rugia artifact contains
it.

The Rugia synchronizer remains limited to card name, type, rarity, and visible
ID. It does not fetch or emit card effect text or images. Admin-created active
records absent from Rugia are not deleted because the importer remains upsert-
only.

## Rules and indexes

- `cards`: public read, all browser writes denied (unchanged).
- `cardMasterArchives`: all browser reads/writes denied.
- `cardMasterAuditLogs`: all browser reads/writes denied.
- Admin access occurs only through callables using Admin Firestore.
- Add an archive index only if the bounded admin query requires it; do not add
  speculative indexes.

## Failure and concurrency behavior

- Two edits of one source: one succeeds; the stale fingerprint fails.
- Edit into an existing deterministic key: no mutation.
- Merge with changed source or target: no mutation.
- Archive/audit write failure: the entire transaction rolls back.
- Callable success followed by UI reload failure: show the successful operation
  plus reload guidance; never invite a duplicate retry.
- Import sees a malformed archive: abort before active-card writes.

## Testing strategy

- Pure Functions tests cover normalization, deterministic keys/fingerprints,
  exact boundaries, authorization, add/edit/rekey/disable/merge, concurrency,
  and zero partial writes.
- Adapter tests cover custom claims, Admin transactions, archive paging,
  timestamps, error mapping, and log redaction.
- Component tests cover all route states, admin-only navigation, forms,
  confirmations, pending/stale behavior, accessibility, and responsive markup.
- Rules Emulator tests prove admins still cannot write protected collections
  from the browser and public users cannot read archives/audits.
- Import tests prove archived keys are reported and suppressed in dry-run and
  apply plans without deletes.
- Chromium E2E uses only the demo Emulator project, injects an admin claim with
  the Emulator Admin SDK, and traces add → edit/rekey → merge → disable while
  proving public search and historical Listing snapshots behave correctly.

## Explicitly out of scope

- A public Card Master page.
- Production admin-claim assignment or deployment.
- Bulk spreadsheet editing, CSV export, approval workflows, or multiple admin
  roles.
- Re-enabling archived cards; it can be designed later with an explicit audit
  policy.
- Rewriting historical Listing/Sale snapshots or user subscriptions after a
  merge.
- Card images, effect text, rulings, aliases, translations, or deck-building.
