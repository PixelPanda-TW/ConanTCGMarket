# Batch 2 Seller Contact Semantics Design

## Purpose

Make the existing single preferred Seller Profile contact method mean one precise thing for each supported service. A seller chooses one of LINE, Discord, Facebook, or Threads. LINE and Discord store account identifiers; Facebook and Threads store personal-profile URLs. The Profile form explains and validates that contract, and Listing detail renders the saved value according to its type.

This batch corrects data meaning and interaction behavior only. It does not yet move contacts out of the public `sellerProfiles` collection or enforce authenticated contact disclosure. Those authorization and migration changes depend on the account-access foundation and belong to later recovery batches.

## Product decisions

- A Seller Profile continues to have one preferred contact method, represented by the existing `contactType` and `contactValue` fields.
- A complete seller profile requires a non-empty display name and one valid preferred contact.
- `line` stores a LINE ID string, not a URL.
- `discord` stores a Discord ID/username string and is displayed as text because there is no reliable public profile URL for an arbitrary Discord ID.
- `facebook` stores an HTTPS Facebook personal-profile URL.
- `threads` stores an HTTPS Threads personal-profile URL.
- Google email is never accepted or displayed as a marketplace contact method.

## Why this is a separate batch

The current schema already models one selected method and is used by Profile creation, Listing detail, E2E fixtures, and Firestore converters. Correcting its validation and presentation is isolated and directly verifiable. Splitting public presentation data from private contact data changes repositories, Rules, Functions, migration behavior, and authentication state; combining that security boundary with field semantics would make failures harder to attribute and rollback.

## Canonical contact rules

All values are trimmed before validation and persistence. Validation is deterministic and does not make a network request.

### LINE

- Accept a non-empty identifier of at most 100 Unicode code points.
- Permit a leading `@` and ordinary identifier punctuation.
- Reject whitespace anywhere in the identifier.
- Reject strings that parse as, or begin like, a URL (`http:`, `https:`, `line:`, or `www.`).
- Listing detail constructs `https://line.me/ti/p/~{encoded-id}` and shows the original ID as the link text.

### Discord

- Accept a non-empty ID/username of at most 100 Unicode code points.
- Reject whitespace and URL-shaped values.
- Do not attempt to enforce Discord's evolving username format beyond those stable constraints.
- Listing detail renders `Discord ID：{value}` as plain text, not an anchor.

### Facebook

- Require an absolute `https:` URL.
- Accept hosts `facebook.com`, `www.facebook.com`, and `m.facebook.com`, case-insensitively.
- Accept either a single non-reserved username path (`/{username}` with an optional trailing slash) or `/profile.php?id={non-empty-id}`.
- Reject credentials, non-default ports, fragments, unrelated query parameters, empty paths, and reserved non-personal paths such as `groups`, `pages`, `events`, `marketplace`, `watch`, `share`, and `reel`.
- Normalize accepted URLs to `https://www.facebook.com/{username}` or `https://www.facebook.com/profile.php?id={id}` before persistence.
- Listing detail uses the canonical URL as an external link and labels it `Facebook 個人頁面`.

### Threads

- Require an absolute `https:` URL.
- Accept hosts `threads.net` and `www.threads.net`, case-insensitively.
- Require exactly one profile path segment in the form `/@{handle}`, with an optional trailing slash.
- Reject post URLs, query strings, fragments, credentials, non-default ports, or an empty handle.
- Normalize accepted URLs to `https://www.threads.net/@{handle}` before persistence.
- Listing detail uses the canonical URL as an external link and labels it `Threads 個人頁面`.

## Shared domain API

Add a contact-focused domain module so the form, model validation, and Listing presentation cannot drift:

```ts
type ContactValidationResult =
  | { ok: true; value: string }
  | { ok: false; reason: 'required' | 'identifier' | 'profile-url' };

function normalizeAndValidateContact(
  contactType: ContactType,
  rawValue: string,
): ContactValidationResult;

function sellerContactPresentation(
  contactType: ContactType,
  contactValue: string,
): { label: string; value: string; href?: string };
```

`normalizeAndValidateContact` is the only source of truth for semantic validation. `sellerContactPresentation` calls the same validator and returns no `href` for invalid legacy values. It must never place an unvalidated value in an anchor `href`.

The Seller Profile converter remains allowlisted. Writes require strict contact semantics. Reads remain structurally backward-compatible so a previously saved value such as a Threads handle can still load in the owner's Profile form and be corrected; reading a legacy document must not manufacture a URL or make an unsafe link. The owner cannot successfully save again until the contact satisfies the new contract.

## Profile form UX

The form remains controlled and keeps errors adjacent to their fields with `role="alert"`. The visible contact label, helper, placeholder, input mode, and autocomplete hint change with `contactType`:

| Type | Input label | Helper | Placeholder |
| --- | --- | --- | --- |
| LINE | LINE ID | 請填寫 LINE ID，不要貼網址。 | 例如：@conanmarket |
| Discord | Discord ID | 只會顯示 ID 文字，不會建立連結。 | 例如：conan_seller |
| Facebook | Facebook 個人頁面連結 | 必須是 facebook.com 的個人頁面 HTTPS 連結。 | https://www.facebook.com/username |
| Threads | Threads 個人頁面連結 | 必須是 threads.net/@帳號 的個人頁面 HTTPS 連結。 | https://www.threads.net/@username |

Changing the contact type keeps the current text visible so the user does not lose input accidentally, clears the prior contact error, and revalidates on submit. URL inputs use `inputMode="url"`; identifier inputs use `inputMode="text"`. The permanent visible label is not replaced by a placeholder.

Error messages are specific and actionable:

- blank: `請填寫聯絡方式。`
- invalid LINE: `請填寫 LINE ID，不要使用網址或空白。`
- invalid Discord: `請填寫 Discord ID，不要使用網址或空白。`
- invalid Facebook: `請填寫有效的 Facebook 個人頁面 HTTPS 連結。`
- invalid Threads: `請填寫有效的 Threads 個人頁面 HTTPS 連結。`

This follows the selected UI guidance: controlled React inputs, persistent associated labels, inline announced errors, and an explicit recovery instruction rather than color-only feedback.

## Listing-detail presentation

The seller display name remains visible. Contact presentation becomes service-specific:

- LINE: external link with text `LINE ID：{id}`.
- Discord: plain text `Discord ID：{id}`.
- Facebook: external link `Facebook 個人頁面`.
- Threads: external link `Threads 個人頁面`.

External anchors use `target="_blank"` and `rel="noreferrer"`. If a structurally readable legacy contact does not pass current semantic validation, render `聯絡方式需要由賣家更新` as non-interactive text. Do not guess a destination and do not silently convert handles into social URLs.

The current loading behavior remains unchanged in this batch. Authenticated-only disclosure and endpoint error states will replace the public repository path later.

## Data compatibility and migration

- No production Firestore mutation occurs in Batch 2.
- Existing canonical LINE and Discord identifiers continue to work.
- Existing valid Facebook/Threads profile URLs normalize on the seller's next successful save.
- Existing Facebook/Threads handles or malformed links remain readable in the owner's form but are not actionable on public Listing detail and must be corrected before any subsequent save.
- `createdAt` remains unchanged on edit and `updatedAt` changes only after a successful strict save.

## Testing strategy

### Unit and component tests

- Table-driven domain tests cover valid, normalized, and rejected values for all four contact types.
- Profile form tests prove type-specific normalization and exact error messages.
- Profile page tests prove dynamic accessible labels/helpers/placeholders and that invalid input never calls the repository.
- Seller Profile model/converter tests prove strict writes and backward-compatible structural reads.
- Listing page tests prove LINE, Facebook, and Threads use only safe expected links; Discord is plain text; invalid legacy values have no anchor.

### Browser tests

- Profile E2E creates an identifier contact, edits to a canonical personal-profile URL, reloads, and confirms persistence.
- Mobile form coverage uses valid examples for every method and confirms the dynamic label remains editable without horizontal overflow.
- Existing Listing lifecycle assertions are updated to the new Discord text.

### Regression gates

- Full frontend, scripts, Functions, Rules, Chromium E2E, lint, and build gates remain green.
- Reference scans confirm there is no generic `href={contactValue}` path and no obsolete Threads handle fixtures.

## Out of scope

Batch 2 does not:

- make contacts private or require login to reveal them;
- add `sellerContacts`, callable Functions, access logs, rate limits, or contact migration;
- introduce multiple simultaneous seller contact methods;
- define buyer/seller account access or suspension behavior;
- implement reports, admin tools, seller follows, or notification delivery;
- verify that a remote social account exists or belongs to the seller.

## Acceptance criteria

1. The four contact types have one documented and enforced meaning.
2. LINE and Discord accept identifiers and reject URLs/whitespace.
3. Facebook accepts only supported HTTPS personal-profile shapes and persists a canonical Facebook URL.
4. Threads accepts only an HTTPS `/@handle` profile URL and persists a canonical Threads URL.
5. Profile fields expose type-specific accessible labels, helpers, placeholders, and actionable inline errors.
6. Invalid input cannot reach `saveSellerProfile` or Firestore conversion.
7. Listing detail renders LINE, Facebook, and Threads as safe service-appropriate links and Discord as ID text only.
8. Invalid legacy contacts never become clickable and can still be loaded by their owner for correction.
9. Existing timestamps and one-preferred-contact schema remain intact.
10. No production data is changed and no authenticated-contact security claim is made by this batch.
