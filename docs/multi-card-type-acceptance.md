# Multi-card-type local acceptance

**Acceptance date:** 2026-08-26

**Status:** Automated application coverage supports shared visible IDs and `P001`; production acceptance remains blocked until the exact generated artifact, report, dry run, and production command pass the controlled gate below and receive explicit user approval.

## Acceptance fixture

The representative artifact contains two distinct canonical Cards sharing visible ID `0501`, plus a prefixed Partner ID:

```json
[
  {"cardId":"0501","cardType":"character","cardName":"諸伏高明","rarities":["D"]},
  {"cardId":"0501","cardType":"event","cardName":"事件 0501","rarities":["D"]},
  {"cardId":"P001","cardType":"partner","cardName":"江戶川柯南","rarities":["P"]}
]
```

Each canonical identity is `cardType + NFC-trimmed cardName + normalized cardId`. The importer writes it to `cards/{card_<full-sha256>}` and retains the visible `cardId` in document data. Shared `cardId` values are valid when type or name differs; Listings continue storing visible snapshots and never store a Card Master key.

## Automated and browser acceptance

Before handoff, run the root tests and production build, Functions tests/build, Rules Emulator tests, and sync/import Node tests documented in the implementation plan. The Rules Emulator must prove that the Admin-seeded `cards/card_test_hash` record with visible `P001` is publicly readable while unauthenticated and authenticated clients cannot create, update, or delete any Card Master document. Existing Listing owner-only mutation behavior must remain unchanged.

At desktop and 375px mobile widths, verify:

1. Sell flow can enter and select `P001` with a text keyboard and creates a Listing containing the visible `cardId`, not a hash.
2. Character `0501` and event `0501` remain separately selectable by type and name.
3. Marketplace searches `P`, `P0`, `P00`, and `P001` correctly, while numeric prefix and exact searches remain intact.
4. Listing detail, Dashboard, Sale, email, and Discord display visible IDs unchanged.
5. A card-ID-only legacy Listing resolves only with exactly one canonical Card Master candidate; shared-ID ambiguity displays `卡片資料不明確` and no character subscription control.
6. No page displays the internal `card_<full-sha256>` key.

## Controlled Card Master gate

Generate the candidate without importing it and retain the complete report:

```sh
npm run sync:cards -- /tmp/conan-card-master-composite.json
node scripts/import-card-master.mjs --dry-run /tmp/conan-card-master-composite.json
```

The sync must complete without an invalid-ID error or artifact refusal. Its report gate requires `keyCollisions=0`, both approved ID formats, shared-ID statistics, duplicate-occurrence statistics, and the controlled `B0982 -> 0982` correction with its count. Any other unknown format stops the sync before an artifact is written; it must never be guessed or repaired by stripping an arbitrary prefix. The dry run must report canonical `records`, `batches`, and `keyCollisions=0` without initializing Firebase Admin.

The artifact and Firestore documents may contain only `cardId`, `cardType`, `cardName`, and `rarities`. They must not contain `officialImage`, image URLs, `effect` or 牌效, traits, or source-internal IDs such as `PR226`.

The migration is a retry-safe, bounded sequence of deterministic idempotent upserts. A failed later batch can be retried with the same artifact. It performs no deletes and specifically does not delete existing `cards/{cardId}` legacy documents.

## Production prohibition

**The following production command is explicitly prohibited.** It remains unexecuted unless the user approves the exact generated artifact and this exact command after reviewing the reports:

```sh
GOOGLE_CLOUD_PROJECT='your-project-id' npm run import:cards -- /tmp/conan-card-master-composite.json
```

No production import, Firebase deploy, legacy cleanup, or push is authorized by this acceptance document.
