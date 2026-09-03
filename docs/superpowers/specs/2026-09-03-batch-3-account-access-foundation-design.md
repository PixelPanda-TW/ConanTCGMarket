# Batch 3 Unified Account Access Foundation Design

## Purpose

Establish one authoritative account-validity state for every Google-authenticated person and enforce it across current privileged buyer and seller actions. Google sign-in alone creates buyer capability. A complete Seller Profile adds seller capability to the same UID. Suspension removes privileged actions while preserving public Marketplace browsing and the signed-in identity needed for a future appeal flow.

This is the authorization foundation for secure contact disclosure, admin Card Master tools, seller follows, and moderation. It does not implement those later features or any production suspension operation.

## Relationship to the earlier identity design

This batch adopts the core `accountAccess/{uid}` model and active-account checks from `2026-08-28-unified-google-identity-and-account-moderation-design.md`, with one explicit refinement required by the subsequently approved appeal policy: a suspended Firebase Auth user is not automatically disabled or signed out. The account remains authenticated but every privileged action is denied by Firestore/Storage Rules and hidden or disabled in the UI. This lets a suspended user see their status/reason and later submit an appeal without creating an unauthenticated side channel.

Admin suspension/restore will revoke refresh tokens after changing account state, forcing clients to refresh authorization state, but will not disable Firebase Authentication by default. A future emergency ban may separately disable an Auth user; that is not the normal suspension model.

## Identity and capabilities

There is one account per Firebase Auth UID and no mutually exclusive buyer/seller role selector.

- Visitor: may browse public active Marketplace data.
- Active Google account: valid buyer; may request protected contact access, follow sellers, manage subscriptions, and report when those features exist.
- Active Google account with a complete Seller Profile: valid buyer and seller; may create/manage Listings and record Sales.
- Suspended Google account: remains signed in and may browse public Marketplace plus read its own status, seller dashboard, Listings, and Sales history. It may not reveal contacts, subscribe/follow, create or edit a Profile/Listing, upload/delete Listing images, record Sales, or submit ordinary reports. A dedicated appeal is the sole future privileged exception.
- Admin: an active Google account with server-issued `admin: true` custom claim. Admin authorization primitives and screens are implemented in later batches; clients can never write claims.

Seller validity is derived from a complete, structurally valid Seller Profile. There is no duplicated `isSeller` flag in account state. Removing or invalidating a Profile removes seller capability but not buyer capability.

## Data model

### `accountAccess/{uid}`

```ts
interface AccountAccess {
  uid: string;
  status: 'active' | 'suspended';
  confirmedViolationCount: number;
  suspensionReason?: string;
  suspendedAt?: Date;
  suspendedBy?: string;
  updatedAt: Date;
}
```

The document is server-owned. Browser clients may read only their own document and may never create, update, or delete it. Admin/server access is deferred to trusted Functions.

A missing document resolves to the immutable default `{ status: 'active', confirmedViolationCount: 0 }` in both client application logic and Rules. This preserves all existing Google accounts without a bulk production write. No browser creates the default document.

Validation rules:

- `status` is exactly `active` or `suspended`;
- `uid` and `suspendedBy` are trimmed identifiers of 1–128 characters;
- violation count is a finite non-negative integer;
- active records omit all suspension-only fields;
- suspended records require a trimmed reason of 1–1000 characters, valid `suspendedAt`, and valid `suspendedBy`;
- `updatedAt` is always valid;
- converter reads/writes an exact allowlist and rejects extra fields.

The client converter accepts server timestamps as Dates. Production writes remain impossible from the client even though a converter exists for tests/repository typing.

## Client account state

`AuthProvider` composes the Firebase Auth observer with a live `accountAccess` document observer.

```ts
type AccountAccessState =
  | { state: 'signed-out' }
  | { state: 'loading' }
  | { state: 'active'; access: AccountAccess | null }
  | { state: 'suspended'; access: AccountAccess }
  | { state: 'unavailable'; message: string };
```

The `null` access on an active state means the server document is missing and the backward-compatible active default applies. `AuthState` exposes `accountAccessState` and `isActiveAccount` in addition to the existing `user`, `isLoading`, `error`, `signIn`, and `signOut` fields.

State transition contract:

1. While Firebase Auth is unresolved, `isLoading` is true and access state is loading.
2. Signed out resolves to `signed-out`, `isLoading=false`, and `isActiveAccount=false`.
3. A signed-in UID starts a fresh account observer and remains loading until its first snapshot/error.
4. Missing document resolves active; an active document resolves active; a suspended document resolves suspended.
5. An access-read error fails closed as `unavailable`; public browsing remains usable, privileged actions do not.
6. UID changes unsubscribe the prior observer and stale callbacks cannot overwrite the new identity.
7. A live status change updates every consuming UI without reload.

Authentication errors and account-access errors remain distinguishable. Sign-in cancellation continues to use the current retryable error path.

## Repository boundary

Add `subscribeAccountAccess(uid, onValue, onError)` in the Firestore repository layer. It listens only to `accountAccess/{uid}`, verifies `auth.currentUser.uid === uid` before opening the listener, maps a missing snapshot to `null`, and returns the Firestore unsubscribe function.

The repository does not infer seller status and does not create access documents. All mutation repositories retain their current same-UID assertions; server enforcement is owned by Rules. Client-side guards improve UX but never replace Rules.

## Firestore authorization

Define a shared Rules helper:

```text
isActiveAccount() = authenticated AND
  (own accountAccess document does not exist OR its status is active)
```

Apply it to all current privileged mutations:

- Seller Profile create/update;
- Listing create/update/delete;
- Sale create;
- notification subscription create/update/delete.

Read policy:

- own `accountAccess` document: authenticated same UID only;
- account access writes: always false;
- Profile owner read and existing public presentation read remain unchanged until the contact split batch;
- public active Listing read remains unchanged;
- Listing owner read remains available while suspended;
- Sale and notification-subscription owner reads remain available while suspended so status/history can be shown;
- all server-only collections remain denied.

Rules check account state even for already-issued tokens. A suspended user therefore cannot bypass the UI with direct SDK calls.

## Storage authorization

Listing images remain publicly readable. Create/update/delete under `listings/{uid}/...` require:

- authenticated request;
- path UID equals request UID;
- the requester's `accountAccess` document is missing or active.

Suspended sellers may still view existing public images but cannot upload replacements or delete objects. Moderation-driven hiding/deletion uses trusted server credentials later.

## Current UI behavior

All current private/action surfaces consume `isActiveAccount` and the detailed state.

### Global Auth status

- Active signed-in users see neutral account wording (`Google 帳號：...`) and all current navigation links.
- Suspended users see `帳號目前已停權，仍可瀏覽公開市集。`, an optional sanitized reason, and only sign-out plus Marketplace navigation already outside the component.
- Unavailable state shows a retry-by-refresh message and no privileged navigation.
- Copy no longer calls every signed-in person a seller.

### Profile and Sell

- Suspended/unavailable users do not load editable Profile data and cannot render the Profile form.
- Sell does not load Profile/Card Master data and renders the same account-state block before any form.
- Active Google users with no Profile see the current setup guidance.
- Active users with a complete Profile see the Listing form.

### Listing edit and owner controls

- Suspended/unavailable owners may view their Listing detail where Rules already permit it, but the `管理此商品` link is hidden.
- Direct edit route renders a non-editable account-status message; it does not upload, update, or delete.

### Dashboard

- Active sellers retain all current listing and Sale controls.
- Suspended sellers may load their own Listings and Sales, including sold-out history, but see a read-only banner with their suspension reason. Edit and `登記成交` actions and the modal are absent.
- An unavailable access state fails closed and does not load private data, because the application cannot establish that the requester is the current active/suspended account.
- Seller Profile completeness is not required merely to read previously owned history.

### Buyer subscriptions

- Suspended/unavailable users cannot open subscription confirmation, mutate subscriptions, or render management controls.
- Notification settings show account-state guidance without loading subscription data.
- Signed-out users retain the Google sign-in prompt.

The authenticated-contact button and ordinary report action do not exist yet; later batches must reuse this state rather than invent separate checks.

## Suspension and Listing visibility boundary

The approved final behavior hides a suspended seller's active Listings and lets the admin choose whether to republish them after restoration. That requires an atomic trusted moderation workflow to transition affected Listings to a moderation-hidden state and record which were active. It cannot safely be accomplished by client Rules or by merely filtering one browser.

Therefore Batch 3 enforces the seller's inability to mutate or transact but does not create suspension operations or change Listing status. Batch 10's trusted suspension transaction will hide active Listings and implement selective republishing. Until that workflow exists, no production account will be marked suspended by this branch.

## Failure and compatibility behavior

- Missing access document is active everywhere, avoiding a flag-day migration.
- Malformed existing access data fails closed in the client converter and yields unavailable UI; Rules treat any non-active present document as denied.
- Access listener failure never signs the user out or hides public Marketplace content.
- Existing test/Auth mocks must explicitly declare account state so tests do not silently assume authorization.
- No production account, Listing, Profile, Sale, subscription, or Storage object is changed in this batch.

## Testing strategy

### Domain/repository/provider

- Account model/converter tables for exact valid/invalid shapes and allowlists.
- Repository tests for same-UID enforcement, missing/active/suspended snapshots, error propagation, and unsubscribe.
- Provider transition tests for signed-out, missing-active, explicit-active, suspended, unavailable, UID switching, and stale callback isolation.

### UI/component

- Auth status navigation/copy per state.
- Profile, Sell, Listing edit/detail, Dashboard, CardNameSubscriptionControl, and NotificationSettings state matrices.
- Suspended Dashboard remains readable while every mutation control is absent.

### Rules/Storage

- Missing/active access permits each owner mutation.
- Suspended access denies every Profile, Listing, Sale, subscription, and Storage mutation.
- Suspended owners retain approved own reads.
- Other users cannot read account access; nobody can write it from browser SDK.

### E2E

- Google sign-in with no access document works as buyer and can become a seller after Profile completion.
- A seeded suspended account can browse Marketplace, sees suspension state, cannot enter Profile/Sell/edit/subscription mutations, and sees Dashboard history without action controls.
- Direct Emulator SDK attempts are covered by Rules rather than only UI assertions.

## Out of scope

Batch 3 does not:

- migrate contacts or make them authenticated-only;
- expose an admin dashboard or trusted suspend/restore endpoint;
- disable Firebase Auth users as the normal suspension mechanism;
- hide Listings as part of a suspension transaction or republish them;
- implement appeals, reports, moderation cases, evidence, or audit events;
- implement seller follows or daily seller digest;
- create duplicated buyer/seller role documents.

## Acceptance criteria

1. A missing `accountAccess` document treats an authenticated Google UID as an active buyer.
2. Seller capability remains derived from a complete Seller Profile and coexists with buyer capability.
3. A live own-account observer exposes loading, active, suspended, and unavailable states without stale UID leakage.
4. Browser clients can read only their own account state and can never write account state.
5. Firestore denies every current privileged mutation by a suspended account while preserving approved owner history reads.
6. Storage denies Listing image writes/deletes by a suspended account.
7. Public Marketplace browsing remains available regardless of the viewer's account state.
8. Suspended users remain signed in, see a clear state/reason, and cannot reach current Profile, Sell, edit, Sale, or subscription mutations.
9. A suspended seller's Dashboard remains readable and has no mutation controls.
10. Active users retain all current successful workflows and existing accounts require no migration.
11. No production suspension or data mutation occurs in Batch 3.
12. Listing hiding/republishing and appeal behavior are explicitly deferred to the trusted moderation workflow, not falsely claimed complete.
