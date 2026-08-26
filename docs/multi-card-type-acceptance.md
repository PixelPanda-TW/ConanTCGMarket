# Multi-card-type local acceptance

**Acceptance date:** 2026-08-26

**Environment:** `feature/multi-card-types` in
`/Users/erinli/Desktop/projects/ConanTCGMarket/.worktrees/multi-card-types`;
local Vite with the existing root `.env` loaded (values not recorded); Google
Chrome 151 headless, localhost-only CDP, and temporary `/tmp` browser profile.
The Vite server and Chrome profile were stopped and removed after the smoke
check.

## Fresh automated verification

The following commands were run on this branch on 2026-08-26:

```sh
set -a; source ../../.env; set +a
NODE_OPTIONS=--no-experimental-webstorage npm test
NODE_OPTIONS=--no-experimental-webstorage npm run build
```

- PASS — `npm test`: 40 test files and 178 tests passed.
- PASS — `npm run build`: TypeScript and Vite production build completed.
  Vite emitted its existing advisory that the 814.71 kB JavaScript chunk exceeds
  the 500 kB warning threshold; this was not a build failure.

## Browser smoke: Marketplace and public Card Master

Smoke pages were loaded locally at the Marketplace route and `#/cards` public
Card Master route. The welcome notice was dismissed in the temporary browser
profile before the Marketplace controls were checked.

| Viewport | Marketplace result | Card Master result |
| --- | --- | --- |
| Desktop 1440 × 900 | PASS — document and body widths were both 1440; no horizontal overflow. The `卡片類型` select (including `事件卡`), `搜尋卡片 ID` text input, shipping checkboxes, and login control were present and within the viewport. | PASS — document and body widths were both 1440; no horizontal overflow. `卡牌資料庫`, the `搜尋卡牌` input, return link, and card rows with type/name/ID text rendered and were within the viewport. |
| Mobile 375 × 812 | PASS — document and body widths were both 375; no horizontal overflow. The type select and ID search occupied x=35–340, and the visible shipping/login controls were within the 375px viewport. Name and rarity are intentionally disabled until a type/name selection is made. | PASS — document and body widths were both 375; no horizontal overflow. The Card Master search and visible card rows occupied x=37–338, while the return link remained reachable at x=20–123. |

This is a rendering/reachability smoke check only. The live Card Master currently
does not provide a clean approved event-card dataset, so it cannot establish a
real event-card Listing through the public UI.

## Blocked end-to-end event-card scenario

**BLOCKED — not PASS.** Do not run this scenario against production until the
controlled Card Master gate below is cleared:

1. Select `事件卡`, type/select a source-approved event name, choose rarity and ID, then create a Listing.
2. Verify Marketplace can find it using only the first two ID digits and then the exact four digits.
3. Verify type/name/rarity filters compose with ID, sleeve, and MyShip filters.
4. Verify Listing detail and Dashboard show type, name, rarity, and ID.
5. Verify no character subscription control appears for the event card.
6. Verify a legacy character Listing still renders and remains subscribable.

## Controlled Card Master gate

The read-only diagnostic found valid unique IDs of `character=895`, `event=69`,
`case=119`, and `partner=1`, with no identity conflicts. It rejected 83 invalid
IDs. A clean generated Card Master artifact is unavailable: strict sync rejects
the alphanumeric ID `P001` and other non-four-digit IDs. Keep the four-digit
contract intact; production import remains blocked pending a clean artifact and
report plus explicit user approval.

The six-step manual scenario is unblocked only when the user supplies or
approves a clean source artifact whose IDs meet the four-decimal-digit contract
(including a decision resolving `P001` and every other alphanumeric ID), a
fresh count/conflict report is produced, and the user explicitly authorizes the
production import. Until then, no production import or Firebase mutation is
authorized.

Before any approved import, the controlled operator must configure Firebase
Admin SDK Application Default Credentials (ADC), for example with
`gcloud auth application-default login`, as described in the
[canonical Card Master import guide](card-master-import.md). Browser Firebase
configuration is not an import credential and is intentionally not reproduced
here.

This exact production command remains intentionally unexecuted:

```sh
GOOGLE_CLOUD_PROJECT='your-project-id' npm run import:cards -- /tmp/conan-card-master-multi-type.json
```
