# Multi-card-type local acceptance

Run this manual scenario against the local app after the automated verification
suite succeeds:

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

This exact production command is intentionally unexecuted:

```sh
FIREBASE_CONFIG='{"apiKey":"…","projectId":"…","appId":"…"}' npm run import:cards -- /tmp/conan-card-master-multi-type.json
```
