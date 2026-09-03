# Batch 2 Seller Contact Semantics Implementation Plan

> **Execution requirement:** Follow this plan task by task with strict RED → GREEN → refactor cycles. Do not add production behavior before its named failing test has been observed.

**Goal:** Enforce service-specific Seller Profile contact values and render safe, correct contact affordances without changing the public-contact storage boundary yet.

**Architecture:** A new pure domain module owns contact validation, canonicalization, form copy, and presentation. Profile form/model/converter code delegates to it. Listing detail consumes a safe presentation object rather than constructing URLs inline. Firestore retains the existing single `contactType`/`contactValue` schema, with strict writes and structurally compatible legacy reads.

**Tech stack:** TypeScript, React 19 controlled forms, Vitest, Testing Library, Firebase Firestore converters, Playwright/Firebase Emulator E2E.

**Approved design:** `docs/superpowers/specs/2026-09-03-batch-2-contact-semantics-design.md`

---

## Task 1: Define the canonical contact domain contract

**Files:**
- Create: `src/domain/sellerContact.ts`
- Create: `src/domain/sellerContact.test.ts`

**Interfaces:**

```ts
export type ContactValidationReason = 'required' | 'identifier' | 'profile-url';

export type ContactValidationResult =
  | { ok: true; value: string }
  | { ok: false; reason: ContactValidationReason };

export interface SellerContactFieldDefinition {
  label: string;
  helper: string;
  placeholder: string;
  inputMode: 'text' | 'url';
  invalidMessage: string;
}

export interface SellerContactPresentation {
  label: string;
  value: string;
  href?: string;
  isValid: boolean;
}
```

- [ ] **Step 1: Add table-driven canonicalization tests**

Create `sellerContact.test.ts` with successful cases:

```ts
it.each([
  ['line', '  @conan.market  ', '@conan.market'],
  ['discord', '  conan_seller  ', 'conan_seller'],
  ['facebook', 'https://m.facebook.com/conan.seller/', 'https://www.facebook.com/conan.seller'],
  ['facebook', 'https://facebook.com/profile.php?id=12345', 'https://www.facebook.com/profile.php?id=12345'],
  ['threads', 'https://threads.net/@conan.seller/', 'https://www.threads.net/@conan.seller'],
] as const)('normalizes a valid %s contact', (contactType, rawValue, value) => {
  expect(normalizeAndValidateContact(contactType, rawValue)).toEqual({ ok: true, value });
});
```

Add rejection tables covering blank input, whitespace inside identifiers, URL-shaped LINE/Discord values, identifier length 101, HTTP social URLs, wrong hosts, credentials, ports, fragments, queries, empty/reserved Facebook paths, Facebook post/group paths, Threads paths without `@`, and Threads post paths. Assert the stable reason (`required`, `identifier`, or `profile-url`).

- [ ] **Step 2: Add field-definition and safe-presentation tests**

Assert all four definitions match the exact approved Chinese labels/helpers/placeholders and input modes. Assert:

```ts
expect(sellerContactPresentation('line', '@conan.market')).toEqual({
  label: 'LINE ID',
  value: '@conan.market',
  href: 'https://line.me/ti/p/~%40conan.market',
  isValid: true,
});
expect(sellerContactPresentation('discord', 'conan_seller')).toEqual({
  label: 'Discord ID', value: 'conan_seller', isValid: true,
});
expect(sellerContactPresentation('threads', '@legacy')).toEqual({
  label: '聯絡方式需要由賣家更新', value: '', isValid: false,
});
```

Also assert Facebook and Threads return their canonical external URLs and invalid values never return `href`.

- [ ] **Step 3: Run the new domain test and verify RED**

```bash
source /Users/erinli/.nvm/nvm.sh
nvm use 22
set -a; source ../../.env; set +a
npm test -- src/domain/sellerContact.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 4: Implement the pure domain module**

Implementation constraints:

- use `Array.from(value).length` for the 100-code-point identifier limit;
- use `/\s/u` and a case-insensitive URL-prefix guard for schemes, `www.`, `line.me/`, `discord.com/`, and `discord.gg/`;
- use the platform `URL` parser only after trimming;
- explicitly reject `username`, `password`, non-empty `hash`, and `port`;
- compare lower-cased hostnames against exact allowlists;
- decode each accepted path segment once inside `try/catch`, then reject `/`, `?`, `#`, or blank decoded content;
- allow Facebook username paths with exactly one segment, except the reserved set from the design;
- allow Facebook `profile.php` only when the sole query key is a non-empty `id`;
- allow Threads only when there is exactly one decoded segment beginning with `@` and containing a non-empty handle;
- construct canonical URLs from validated decoded values with `encodeURIComponent` where needed;
- return definitions from a complete `Record<ContactType, SellerContactFieldDefinition>`;
- make presentation call the validator and return the non-interactive legacy label on failure.

Consumers import the module directly from `domain/sellerContact`; keep `ContactType` in `domain/models` so no new barrel cycle is introduced.

- [ ] **Step 5: Run the domain test and verify GREEN**

Run the Step 3 command. Expected: every seller-contact test passes.

- [ ] **Step 6: Commit the contact contract**

```bash
git add src/domain/sellerContact.ts src/domain/sellerContact.test.ts
git commit -m "feat: define seller contact semantics"
```

---

## Task 2: Enforce strict writes while preserving legacy reads

**Files:**
- Modify: `src/domain/models/sellerProfile.ts`
- Modify: `src/domain/models/domainModels.test.ts`
- Modify: `src/data/firestore/converters.ts`
- Modify: `src/data/firestore/converters.test.ts`

**Interfaces:**

```ts
export function validateSellerProfileStructure(profile: SellerProfile): void;
export function validateSellerProfile(profile: SellerProfile): void;
```

`validateSellerProfileStructure` validates UID, display name, supported type, non-empty string contact, and dates. `validateSellerProfile` calls the structure validator and then requires the contact validator to return the same canonical value already stored.

- [ ] **Step 1: Add model RED tests**

Extend `domainModels.test.ts` to assert:

- strict validation accepts canonical LINE, Discord, Facebook, and Threads profiles;
- strict validation rejects a Threads handle, a Facebook group URL, URL-shaped Discord, and a valid-but-noncanonical `m.facebook.com` URL;
- structural validation accepts the legacy Threads handle so it remains readable.

Run:

```bash
npm test -- src/domain/models/domainModels.test.ts
```

Expected: FAIL because semantic and structural validators do not exist.

- [ ] **Step 2: Implement structural and strict validators**

Keep existing error strings for structural failures. For a semantic or noncanonical contact, throw `Seller profile requires a canonical contactValue for contactType.`. Do not mutate the passed profile.

Run the model test and verify GREEN.

- [ ] **Step 3: Add converter RED tests**

In `converters.test.ts`:

- assert `toFirestore` rejects legacy `threads: '@legacy'`;
- assert `toFirestore` writes a canonical Threads URL unchanged;
- assert `fromFirestore` still returns a legacy `threads: '@legacy'` document;
- retain the exact allowlist assertion.

Run:

```bash
npm test -- src/data/firestore/converters.test.ts
```

Expected: the legacy write assertion fails and the legacy read throws under the current shared validator.

- [ ] **Step 4: Separate converter read and write validation**

- `toFirestore` calls strict `validateSellerProfile`.
- `fromFirestore` calls `validateSellerProfileStructure`.
- Neither converter normalizes silently; Profile form normalization owns canonicalization before save.

Run converter and model tests together and verify GREEN.

- [ ] **Step 5: Commit model/converter compatibility**

```bash
git add src/domain/models/sellerProfile.ts src/domain/models/domainModels.test.ts src/data/firestore/converters.ts src/data/firestore/converters.test.ts
git commit -m "feat: validate canonical seller contacts on write"
```

---

## Task 3: Connect Profile form validation to the shared contract

**Files:**
- Modify: `src/features/profile/profileForm.ts`
- Modify: `src/features/profile/profileForm.test.ts`

- [ ] **Step 1: Add Profile form RED tests**

Add tests that prove:

- valid Facebook and Threads URLs are canonicalized in returned `values`;
- LINE and Discord URLs/whitespace receive their exact identifier errors;
- malformed Facebook and Threads values receive their exact personal-page errors;
- blank continues to receive only `請填寫聯絡方式。`;
- unsupported type continues to receive the type error and does not throw.

Run:

```bash
npm test -- src/features/profile/profileForm.test.ts
```

Expected: semantic cases fail because only non-empty validation exists.

- [ ] **Step 2: Delegate normalization and errors to the domain module**

Keep display-name/type trimming. For a supported type, call `normalizeAndValidateContact`:

- on success, replace `values.contactValue` with its canonical `value`;
- on `required`, use the shared blank error;
- otherwise use `sellerContactFieldDefinition(type).invalidMessage`;
- for unsupported types, return the existing `contactType` error without indexing an unsafe record key.

Run the focused tests and verify GREEN.

- [ ] **Step 3: Commit form-domain integration**

```bash
git add src/features/profile/profileForm.ts src/features/profile/profileForm.test.ts
git commit -m "feat: validate profile contacts by service"
```

---

## Task 4: Make the Profile UI explain the selected contact type

**Files:**
- Create: `src/features/profile/SellerProfilePage.test.tsx`
- Modify: `src/features/profile/SellerProfilePage.tsx`

- [ ] **Step 1: Add component RED tests with controlled dependencies**

Mock `useAuth`, `getSellerProfile`, and `saveSellerProfile`. Cover:

1. a signed-in user with no saved profile sees `LINE ID`, its helper and placeholder;
2. selecting Discord updates the accessible input label/helper/placeholder and keeps entered text;
3. selecting Facebook sets `inputMode="url"` and shows the personal-page helper;
4. submitting an invalid Threads handle shows the exact inline alert and never calls `saveSellerProfile`;
5. submitting a valid `m.facebook.com` profile URL calls `saveSellerProfile` once with the canonical `www.facebook.com` value and shows success.

Use `getByLabelText`/`getByRole`, not test IDs. Await the completed profile load before interacting.

- [ ] **Step 2: Run component tests and verify RED**

```bash
npm test -- src/features/profile/SellerProfilePage.test.tsx
```

Expected: FAIL because the input still has the generic label and no helper/placeholder/input-mode behavior.

- [ ] **Step 3: Render the field definition accessibly**

In `SellerProfilePage.tsx`:

- derive the current definition from `sellerContactFieldDefinition(form.contactType)`;
- add stable `id="seller-contact-value"` and a matching `htmlFor` label;
- render the exact dynamic label;
- render helper text with `id="seller-contact-helper"`;
- set `aria-describedby` to helper plus error when present;
- set `placeholder` and `inputMode` from the definition;
- retain controlled state, current-text preservation on type changes, inline alerts, async request guard, and success behavior.

Run the component test plus Profile form tests and verify GREEN.

- [ ] **Step 4: Commit the Profile UX**

```bash
git add src/features/profile/SellerProfilePage.tsx src/features/profile/SellerProfilePage.test.tsx
git commit -m "feat: clarify seller contact profile fields"
```

---

## Task 5: Render safe service-specific Listing contacts

**Files:**
- Modify: `src/features/listings/ListingPage.test.tsx`
- Modify: `src/features/listings/ListingPage.tsx`

- [ ] **Step 1: Add Listing presentation RED tests**

Add a nested `describe('seller contact presentation')` with a helper that changes the repository seller result. Assert:

- LINE renders a `LINE ID：seller` external link with the encoded `line.me` href;
- Discord renders `Discord ID：seller_name` and no link with that name;
- Facebook renders `Facebook 個人頁面` linked to the exact canonical URL;
- Threads renders `Threads 個人頁面` linked to the exact canonical URL;
- legacy Threads `@legacy` renders `聯絡方式需要由賣家更新` with no contact anchor;
- a malicious `javascript:` value never appears in any `href`.

- [ ] **Step 2: Run Listing tests and verify RED**

```bash
npm test -- src/features/listings/ListingPage.test.tsx
```

Expected: service-specific text/link assertions fail because the page builds only LINE URLs and wraps every contact in an anchor.

- [ ] **Step 3: Consume safe presentation data**

Import `sellerContactPresentation`, derive it only when `seller` exists, and render:

```tsx
{contact.href ? (
  <a className="contact-link" href={contact.href} target="_blank" rel="noreferrer">
    {contact.label}{contact.value ? `：${contact.value}` : ''}
  </a>
) : (
  <p className="contact-value">{contact.label}{contact.value ? `：${contact.value}` : ''}</p>
)}
```

Do not pass raw `contactValue` to `href`. Preserve seller/loading, note, owner edit, and Listing metadata behavior.

Run Listing and seller-contact tests and verify GREEN.

- [ ] **Step 4: Commit Listing presentation**

```bash
git add src/features/listings/ListingPage.tsx src/features/listings/ListingPage.test.tsx
git commit -m "feat: render safe seller contact actions"
```

---

## Task 6: Update browser contracts and current documentation

**Files:**
- Modify: `e2e/auth-profile.spec.ts`
- Modify: `e2e/mobile-forms.spec.ts`
- Modify: `e2e/listing-lifecycle.spec.ts`
- Modify: `e2e/support/ui.ts` only if its accessible selector changes
- Modify: `docs/milestones.md`

- [ ] **Step 1: Update Profile E2E inputs and expectations**

- Replace generic contact input queries with the currently selected dynamic label.
- Keep initial Discord creation through `createSellerProfile` using `Discord ID`.
- Edit the profile to Threads with `https://threads.net/@updated/` and expect persisted `https://www.threads.net/@updated`.
- Reload and assert the dynamic `Threads 個人頁面連結` field has the canonical value.
- In validation coverage, use initial `LINE ID` and retain blank-error/no-write assertions.

- [ ] **Step 2: Update mobile Profile interaction**

For each select option, query and verify the matching dynamic label and helper. Use valid values per type. Finish with a valid Threads profile URL and canonical persistence/reload assertions. Preserve mobile editability and no-horizontal-scroll checks.

- [ ] **Step 3: Update Listing lifecycle wording**

Replace `以 discord 聯絡：e2e-seller` with `Discord ID：e2e-seller` and assert it is not a link.

- [ ] **Step 4: Update the current Seller Profile milestone**

In `docs/milestones.md`, update Milestone 3 to state the one-preferred-contact contract and list the LINE/Discord identifier and Facebook/Threads personal-profile URL semantics. Keep authenticated-only disclosure explicitly pending rather than claiming it is complete.

- [ ] **Step 5: Run formatting and reference scans**

```bash
rg -n "聯絡帳號或連結|@updated|@mobile-updated|以 discord 聯絡" src e2e docs/milestones.md
rg -n "href=.*contactValue|href=\{seller\.contactValue\}" src
git diff --check
```

Expected: no obsolete fixture/wording or raw contact href matches.

- [ ] **Step 6: Commit browser/docs updates**

```bash
git add e2e docs/milestones.md
git commit -m "test: cover seller contact semantics end to end"
```

---

## Task 7: Verify Batch 2 end to end

**Files:** Verify only unless a failure creates a new RED → GREEN cycle.

- [ ] **Step 1: Run focused frontend tests**

```bash
source /Users/erinli/.nvm/nvm.sh
nvm use 22
set -a; source ../../.env; set +a
npm test -- \
  src/domain/sellerContact.test.ts \
  src/domain/models/domainModels.test.ts \
  src/data/firestore/converters.test.ts \
  src/features/profile/profileForm.test.ts \
  src/features/profile/SellerProfilePage.test.tsx \
  src/features/listings/ListingPage.test.tsx
```

- [ ] **Step 2: Run complete quality gates**

```bash
npm test
npm run test:scripts
npm run test:functions
npm --prefix functions run lint
npm run build:functions
npm run build
```

- [ ] **Step 3: Run Emulator gates with clean environments**

Do not export the production `.env` before these commands; Rules/E2E own their demo configuration.

```bash
npm run test:rules
npm run test:e2e:chromium
```

- [ ] **Step 4: Run final acceptance scans**

```bash
rg -n "聯絡帳號或連結|@updated|@mobile-updated|以 discord 聯絡" src e2e docs/milestones.md
rg -n "href=.*contactValue|href=\{seller\.contactValue\}" src
git diff --check
git status -sb
git log --oneline --decorate -12
```

Expected: all commands pass, removed strings have no matches, worktree is clean, and each acceptance criterion has direct test or scan evidence.

## Completion gate

Before starting Batch 3, review every acceptance criterion in the approved Batch 2 spec against the domain, form, component, converter, Listing, E2E, and scan evidence. Any missing evidence requires a new failing test and RED → GREEN cycle. No production data migration or deployment is part of this batch.
