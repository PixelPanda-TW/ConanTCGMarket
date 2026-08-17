# Firestore Schema and Repositories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define the MVP Firestore data models, converters, and repository functions for active listings, seller listings, and seller sales.

**Architecture:** Domain models live in `src/domain/models/` and contain framework-free TypeScript types plus validation helpers. Firestore-specific converters and query builders live under `src/data/firestore/`, so UI components do not hard-code collection paths or Firestore query details.

**Tech Stack:** React, TypeScript, Vite, Firebase Web SDK, Cloud Firestore, Vitest.

## Global Constraints

- Frontend is React, TypeScript, and Vite.
- Firebase config comes from `VITE_FIREBASE_*` environment variables.
- Buyers do not need accounts to browse active marketplace listings.
- Seller-only data access must be scoped by seller UID.
- Google email is not public data and must not be included in seller profile or listing models.
- Card Master is public-read and contains only allowed text fields: `id`, `nameZh`, `nameJa`, and `rarity`.
- Card Master must not store official card images or card effect text.
- A `Card` must have at least one of `nameZh` or `nameJa`.
- Listing statuses are exactly `"active"` and `"sold_out"`.
- Public marketplace queries must read only active listings.
- UI code must not directly hard-code Firestore collection paths.

---

## File Structure

- `src/domain/models/card.ts`: `Card` type and `validateCard()`.
- `src/domain/models/listing.ts`: `Listing`, `ListingStatus`, and listing validation helpers.
- `src/domain/models/sellerProfile.ts`: `SellerProfile`, `ContactType`, and validation helpers.
- `src/domain/models/sale.ts`: `Sale` type and validation helpers.
- `src/domain/models/index.ts`: Public exports for domain models.
- `src/data/firestore/database.ts`: Exports `firestoreDb = getFirestore(firebaseApp)`.
- `src/data/firestore/paths.ts`: Centralizes collection path constants.
- `src/data/firestore/converters.ts`: Firestore converters for `Card`, `Listing`, `SellerProfile`, and `Sale`.
- `src/data/firestore/repositories/listingRepository.ts`: Active and seller listing query functions.
- `src/data/firestore/repositories/saleRepository.ts`: Seller sale query function.
- `src/data/firestore/repositories/index.ts`: Public repository exports.

## Task 1: Domain Models and Validation

**Files:**
- Create: `src/domain/models/card.ts`
- Create: `src/domain/models/listing.ts`
- Create: `src/domain/models/sellerProfile.ts`
- Create: `src/domain/models/sale.ts`
- Create: `src/domain/models/index.ts`
- Test: `src/domain/models/domainModels.test.ts`

**Interfaces:**
- Produces: `Card`, `Listing`, `ListingStatus`, `SellerProfile`, `ContactType`, and `Sale`.
- Produces: `validateCard(card: Card): void`.
- Produces: `validateListing(listing: Listing): void`.
- Produces: `validateSellerProfile(profile: SellerProfile): void`.
- Produces: `validateSale(sale: Sale): void`.

- [ ] **Step 1: Write failing domain model tests**

Create `src/domain/models/domainModels.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  validateCard,
  validateListing,
  validateSale,
  validateSellerProfile,
  type Card,
  type Listing,
  type Sale,
  type SellerProfile,
} from './index';

describe('domain model validation', () => {
  it('requires each card to have a Chinese or Japanese name', () => {
    const card: Card = {
      id: 'CT-P01-001',
      rarity: 'CP',
    };

    expect(() => validateCard(card)).toThrow('Card requires nameZh or nameJa.');
  });

  it('accepts a valid active listing with positive quantities', () => {
    const listing: Listing = {
      id: 'listing-1',
      sellerId: 'seller-1',
      cardId: 'CT-P01-001',
      imageUrls: ['https://example.com/card.jpg'],
      listingPrice: 500,
      originalQuantity: 5,
      remainingQuantity: 3,
      hasSleeve: true,
      supportsMyShip: true,
      status: 'active',
      createdAt: new Date('2026-08-17T00:00:00.000Z'),
      updatedAt: new Date('2026-08-17T00:00:00.000Z'),
    };

    expect(() => validateListing(listing)).not.toThrow();
  });

  it('rejects listings without photos', () => {
    const listing: Listing = {
      id: 'listing-1',
      sellerId: 'seller-1',
      cardId: 'CT-P01-001',
      imageUrls: [],
      listingPrice: 500,
      originalQuantity: 5,
      remainingQuantity: 5,
      hasSleeve: true,
      supportsMyShip: true,
      status: 'active',
      createdAt: new Date('2026-08-17T00:00:00.000Z'),
      updatedAt: new Date('2026-08-17T00:00:00.000Z'),
    };

    expect(() => validateListing(listing)).toThrow('Listing requires 1 to 3 image URLs.');
  });

  it('rejects seller profiles without contact values', () => {
    const profile: SellerProfile = {
      uid: 'seller-1',
      displayName: 'Seller',
      contactType: 'line',
      contactValue: '',
      createdAt: new Date('2026-08-17T00:00:00.000Z'),
      updatedAt: new Date('2026-08-17T00:00:00.000Z'),
    };

    expect(() => validateSellerProfile(profile)).toThrow('Seller profile requires contactValue.');
  });

  it('rejects sale quantity above zero requirement', () => {
    const sale: Sale = {
      id: 'sale-1',
      listingId: 'listing-1',
      sellerId: 'seller-1',
      cardId: 'CT-P01-001',
      quantity: 0,
      listingUnitPrice: 500,
      soldUnitPrice: 450,
      soldAt: new Date('2026-08-17T00:00:00.000Z'),
    };

    expect(() => validateSale(sale)).toThrow('Sale quantity must be greater than 0.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
VITE_FIREBASE_API_KEY=fake-api-key VITE_FIREBASE_AUTH_DOMAIN=fake-project.firebaseapp.com VITE_FIREBASE_PROJECT_ID=fake-project VITE_FIREBASE_STORAGE_BUCKET=fake-project.appspot.com VITE_FIREBASE_MESSAGING_SENDER_ID=123456789012 VITE_FIREBASE_APP_ID=1:123456789012:web:fakeapp npm test -- src/domain/models/domainModels.test.ts
```

Expected: FAIL because `src/domain/models/index.ts` does not exist.

- [ ] **Step 3: Implement domain models**

Create `src/domain/models/card.ts`:

```ts
export interface Card {
  id: string;
  nameZh?: string;
  nameJa?: string;
  rarity: string;
}

export function validateCard(card: Card) {
  if (!card.id) {
    throw new Error('Card requires id.');
  }

  if (!card.nameZh && !card.nameJa) {
    throw new Error('Card requires nameZh or nameJa.');
  }

  if (!card.rarity) {
    throw new Error('Card requires rarity.');
  }
}
```

Create `src/domain/models/listing.ts`:

```ts
export type ListingStatus = 'active' | 'sold_out';

export interface Listing {
  id: string;
  sellerId: string;
  cardId: string;
  imageUrls: string[];
  listingPrice: number;
  originalQuantity: number;
  remainingQuantity: number;
  hasSleeve: boolean;
  supportsMyShip: boolean;
  note?: string;
  status: ListingStatus;
  createdAt: Date;
  updatedAt: Date;
}

export function validateListing(listing: Listing) {
  if (!listing.id) {
    throw new Error('Listing requires id.');
  }

  if (!listing.sellerId) {
    throw new Error('Listing requires sellerId.');
  }

  if (!listing.cardId) {
    throw new Error('Listing requires cardId.');
  }

  if (listing.imageUrls.length < 1 || listing.imageUrls.length > 3) {
    throw new Error('Listing requires 1 to 3 image URLs.');
  }

  if (listing.listingPrice <= 0) {
    throw new Error('Listing price must be greater than 0.');
  }

  if (listing.originalQuantity <= 0) {
    throw new Error('Listing originalQuantity must be greater than 0.');
  }

  if (listing.remainingQuantity < 0 || listing.remainingQuantity > listing.originalQuantity) {
    throw new Error('Listing remainingQuantity must be between 0 and originalQuantity.');
  }

  if (listing.status !== 'active' && listing.status !== 'sold_out') {
    throw new Error('Listing status must be active or sold_out.');
  }
}
```

Create `src/domain/models/sellerProfile.ts`:

```ts
export type ContactType = 'line' | 'discord' | 'threads' | 'facebook';

export interface SellerProfile {
  uid: string;
  displayName: string;
  contactType: ContactType;
  contactValue: string;
  createdAt: Date;
  updatedAt: Date;
}

const contactTypes: ContactType[] = ['line', 'discord', 'threads', 'facebook'];

export function validateSellerProfile(profile: SellerProfile) {
  if (!profile.uid) {
    throw new Error('Seller profile requires uid.');
  }

  if (!profile.displayName) {
    throw new Error('Seller profile requires displayName.');
  }

  if (!contactTypes.includes(profile.contactType)) {
    throw new Error('Seller profile requires a supported contactType.');
  }

  if (!profile.contactValue) {
    throw new Error('Seller profile requires contactValue.');
  }
}
```

Create `src/domain/models/sale.ts`:

```ts
export interface Sale {
  id: string;
  listingId: string;
  sellerId: string;
  cardId: string;
  quantity: number;
  listingUnitPrice: number;
  soldUnitPrice: number;
  soldAt: Date;
}

export function validateSale(sale: Sale) {
  if (!sale.id) {
    throw new Error('Sale requires id.');
  }

  if (!sale.listingId) {
    throw new Error('Sale requires listingId.');
  }

  if (!sale.sellerId) {
    throw new Error('Sale requires sellerId.');
  }

  if (!sale.cardId) {
    throw new Error('Sale requires cardId.');
  }

  if (sale.quantity <= 0) {
    throw new Error('Sale quantity must be greater than 0.');
  }

  if (sale.listingUnitPrice <= 0) {
    throw new Error('Sale listingUnitPrice must be greater than 0.');
  }

  if (sale.soldUnitPrice <= 0) {
    throw new Error('Sale soldUnitPrice must be greater than 0.');
  }
}
```

Create `src/domain/models/index.ts`:

```ts
export * from './card';
export * from './listing';
export * from './sellerProfile';
export * from './sale';
```

- [ ] **Step 4: Run tests**

Run:

```bash
VITE_FIREBASE_API_KEY=fake-api-key VITE_FIREBASE_AUTH_DOMAIN=fake-project.firebaseapp.com VITE_FIREBASE_PROJECT_ID=fake-project VITE_FIREBASE_STORAGE_BUCKET=fake-project.appspot.com VITE_FIREBASE_MESSAGING_SENDER_ID=123456789012 VITE_FIREBASE_APP_ID=1:123456789012:web:fakeapp npm test -- src/domain/models/domainModels.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/models
git commit -m "Add marketplace domain models"
```

## Task 2: Firestore Database and Converters

**Files:**
- Create: `src/data/firestore/database.ts`
- Create: `src/data/firestore/paths.ts`
- Create: `src/data/firestore/converters.ts`
- Test: `src/data/firestore/converters.test.ts`

**Interfaces:**
- Consumes: `firebaseApp` from `src/lib/firebase/app.ts`.
- Consumes: domain model exports from `src/domain/models`.
- Produces: `firestoreDb`.
- Produces: `collections` with `cards`, `listings`, `sellerProfiles`, and `sales`.
- Produces: `cardConverter`, `listingConverter`, `sellerProfileConverter`, and `saleConverter`.

- [ ] **Step 1: Write failing converter tests**

Create `src/data/firestore/converters.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import {
  cardConverter,
  listingConverter,
  saleConverter,
  sellerProfileConverter,
} from './converters';

describe('Firestore converters', () => {
  it('converts Firestore listing timestamps to Date values', () => {
    const snapshot = {
      id: 'listing-1',
      data: () => ({
        sellerId: 'seller-1',
        cardId: 'CT-P01-001',
        imageUrls: ['https://example.com/card.jpg'],
        listingPrice: 500,
        originalQuantity: 5,
        remainingQuantity: 3,
        hasSleeve: true,
        supportsMyShip: true,
        status: 'active',
        createdAt: Timestamp.fromDate(new Date('2026-08-17T00:00:00.000Z')),
        updatedAt: Timestamp.fromDate(new Date('2026-08-17T01:00:00.000Z')),
      }),
    };

    expect(listingConverter.fromFirestore(snapshot as never)).toMatchObject({
      id: 'listing-1',
      createdAt: new Date('2026-08-17T00:00:00.000Z'),
      updatedAt: new Date('2026-08-17T01:00:00.000Z'),
    });
  });

  it('omits model ids when writing document data', () => {
    expect(
      cardConverter.toFirestore({
        id: 'CT-P01-001',
        nameZh: '諸伏景光',
        rarity: 'CP',
      }),
    ).toEqual({
      nameZh: '諸伏景光',
      rarity: 'CP',
    });
  });

  it('converts seller profile timestamps to Date values', () => {
    const snapshot = {
      id: 'seller-1',
      data: () => ({
        displayName: 'Seller',
        contactType: 'line',
        contactValue: 'seller-line',
        createdAt: Timestamp.fromDate(new Date('2026-08-17T00:00:00.000Z')),
        updatedAt: Timestamp.fromDate(new Date('2026-08-17T01:00:00.000Z')),
      }),
    };

    expect(sellerProfileConverter.fromFirestore(snapshot as never)).toMatchObject({
      uid: 'seller-1',
      updatedAt: new Date('2026-08-17T01:00:00.000Z'),
    });
  });

  it('converts sale timestamps to Date values', () => {
    const snapshot = {
      id: 'sale-1',
      data: () => ({
        listingId: 'listing-1',
        sellerId: 'seller-1',
        cardId: 'CT-P01-001',
        quantity: 2,
        listingUnitPrice: 500,
        soldUnitPrice: 450,
        soldAt: Timestamp.fromDate(new Date('2026-08-17T00:00:00.000Z')),
      }),
    };

    expect(saleConverter.fromFirestore(snapshot as never)).toMatchObject({
      id: 'sale-1',
      soldAt: new Date('2026-08-17T00:00:00.000Z'),
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
VITE_FIREBASE_API_KEY=fake-api-key VITE_FIREBASE_AUTH_DOMAIN=fake-project.firebaseapp.com VITE_FIREBASE_PROJECT_ID=fake-project VITE_FIREBASE_STORAGE_BUCKET=fake-project.appspot.com VITE_FIREBASE_MESSAGING_SENDER_ID=123456789012 VITE_FIREBASE_APP_ID=1:123456789012:web:fakeapp npm test -- src/data/firestore/converters.test.ts
```

Expected: FAIL because `src/data/firestore/converters.ts` does not exist.

- [ ] **Step 3: Implement Firestore database, paths, and converters**

Create `src/data/firestore/database.ts`:

```ts
import { getFirestore } from 'firebase/firestore';
import { firebaseApp } from '../../lib/firebase/app';

export const firestoreDb = getFirestore(firebaseApp);
```

Create `src/data/firestore/paths.ts`:

```ts
export const collections = {
  cards: 'cards',
  listings: 'listings',
  sellerProfiles: 'sellerProfiles',
  sales: 'sales',
} as const;
```

Create `src/data/firestore/converters.ts`:

```ts
import {
  Timestamp,
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
  type SnapshotOptions,
} from 'firebase/firestore';
import {
  validateCard,
  validateListing,
  validateSale,
  validateSellerProfile,
  type Card,
  type Listing,
  type Sale,
  type SellerProfile,
} from '../../domain/models';

type FirestoreData = Record<string, unknown>;

function readData(snapshot: QueryDocumentSnapshot, options?: SnapshotOptions): FirestoreData {
  return snapshot.data(options);
}

function timestampToDate(value: unknown, fieldName: string): Date {
  if (!(value instanceof Timestamp)) {
    throw new Error(`Expected Firestore Timestamp for ${fieldName}.`);
  }

  return value.toDate();
}

function dateToTimestamp(value: Date): Timestamp {
  return Timestamp.fromDate(value);
}

export const cardConverter: FirestoreDataConverter<Card> = {
  toFirestore(card) {
    const cardData = card as Card;
    validateCard(cardData);
    const { id: _id, ...data } = cardData;
    return data;
  },
  fromFirestore(snapshot, options) {
    const data = readData(snapshot, options);
    const card: Card = {
      id: snapshot.id,
      nameZh: data.nameZh as string | undefined,
      nameJa: data.nameJa as string | undefined,
      rarity: data.rarity as string,
    };

    validateCard(card);
    return card;
  },
};

export const listingConverter: FirestoreDataConverter<Listing> = {
  toFirestore(listing) {
    const listingData = listing as Listing;
    validateListing(listingData);
    const { id: _id, createdAt, updatedAt, ...data } = listingData;

    return {
      ...data,
      createdAt: dateToTimestamp(createdAt),
      updatedAt: dateToTimestamp(updatedAt),
    };
  },
  fromFirestore(snapshot, options) {
    const data = readData(snapshot, options);
    const listing: Listing = {
      id: snapshot.id,
      sellerId: data.sellerId as string,
      cardId: data.cardId as string,
      imageUrls: data.imageUrls as string[],
      listingPrice: data.listingPrice as number,
      originalQuantity: data.originalQuantity as number,
      remainingQuantity: data.remainingQuantity as number,
      hasSleeve: data.hasSleeve as boolean,
      supportsMyShip: data.supportsMyShip as boolean,
      note: data.note as string | undefined,
      status: data.status as Listing['status'],
      createdAt: timestampToDate(data.createdAt, 'createdAt'),
      updatedAt: timestampToDate(data.updatedAt, 'updatedAt'),
    };

    validateListing(listing);
    return listing;
  },
};

export const sellerProfileConverter: FirestoreDataConverter<SellerProfile> = {
  toFirestore(profile) {
    const profileData = profile as SellerProfile;
    validateSellerProfile(profileData);
    const { uid: _uid, createdAt, updatedAt, ...data } = profileData;

    return {
      ...data,
      createdAt: dateToTimestamp(createdAt),
      updatedAt: dateToTimestamp(updatedAt),
    };
  },
  fromFirestore(snapshot, options) {
    const data = readData(snapshot, options);
    const profile: SellerProfile = {
      uid: snapshot.id,
      displayName: data.displayName as string,
      contactType: data.contactType as SellerProfile['contactType'],
      contactValue: data.contactValue as string,
      createdAt: timestampToDate(data.createdAt, 'createdAt'),
      updatedAt: timestampToDate(data.updatedAt, 'updatedAt'),
    };

    validateSellerProfile(profile);
    return profile;
  },
};

export const saleConverter: FirestoreDataConverter<Sale> = {
  toFirestore(sale) {
    const saleData = sale as Sale;
    validateSale(saleData);
    const { id: _id, soldAt, ...data } = saleData;

    return {
      ...data,
      soldAt: dateToTimestamp(soldAt),
    };
  },
  fromFirestore(snapshot, options) {
    const data = readData(snapshot, options);
    const sale: Sale = {
      id: snapshot.id,
      listingId: data.listingId as string,
      sellerId: data.sellerId as string,
      cardId: data.cardId as string,
      quantity: data.quantity as number,
      listingUnitPrice: data.listingUnitPrice as number,
      soldUnitPrice: data.soldUnitPrice as number,
      soldAt: timestampToDate(data.soldAt, 'soldAt'),
    };

    validateSale(sale);
    return sale;
  },
};
```

- [ ] **Step 4: Run tests**

Run:

```bash
VITE_FIREBASE_API_KEY=fake-api-key VITE_FIREBASE_AUTH_DOMAIN=fake-project.firebaseapp.com VITE_FIREBASE_PROJECT_ID=fake-project VITE_FIREBASE_STORAGE_BUCKET=fake-project.appspot.com VITE_FIREBASE_MESSAGING_SENDER_ID=123456789012 VITE_FIREBASE_APP_ID=1:123456789012:web:fakeapp npm test -- src/data/firestore/converters.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/firestore src/domain/models
git commit -m "Add Firestore converters"
```

## Task 3: Listing Repository Query Builders

**Files:**
- Create: `src/data/firestore/repositories/listingRepository.ts`
- Create: `src/data/firestore/repositories/index.ts`
- Test: `src/data/firestore/repositories/listingRepository.test.ts`

**Interfaces:**
- Consumes: `firestoreDb`, `collections`, and `listingConverter`.
- Produces: `activeListingsQuery(): Query<Listing>`.
- Produces: `sellerListingsQuery(sellerId: string): Query<Listing>`.
- Produces: `listActiveListings(): Promise<Listing[]>`.
- Produces: `listSellerListings(sellerId: string): Promise<Listing[]>`.

- [ ] **Step 1: Write failing repository tests**

Create `src/data/firestore/repositories/listingRepository.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { activeListingsQueryConstraints, sellerListingsQueryConstraints } from './listingRepository';

describe('listing repository query constraints', () => {
  it('filters public marketplace listings to active status', () => {
    expect(activeListingsQueryConstraints()).toEqual([
      { field: 'status', operator: '==', value: 'active' },
    ]);
  });

  it('filters seller listings by sellerId', () => {
    expect(sellerListingsQueryConstraints('seller-1')).toEqual([
      { field: 'sellerId', operator: '==', value: 'seller-1' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
VITE_FIREBASE_API_KEY=fake-api-key VITE_FIREBASE_AUTH_DOMAIN=fake-project.firebaseapp.com VITE_FIREBASE_PROJECT_ID=fake-project VITE_FIREBASE_STORAGE_BUCKET=fake-project.appspot.com VITE_FIREBASE_MESSAGING_SENDER_ID=123456789012 VITE_FIREBASE_APP_ID=1:123456789012:web:fakeapp npm test -- src/data/firestore/repositories/listingRepository.test.ts
```

Expected: FAIL because `listingRepository.ts` does not exist.

- [ ] **Step 3: Implement listing repository**

Create `src/data/firestore/repositories/listingRepository.ts` with:

```ts
import { collection, getDocs, query, where, type QueryConstraint } from 'firebase/firestore';
import type { Listing } from '../../../domain/models';
import { listingConverter } from '../converters';
import { firestoreDb } from '../database';
import { collections } from '../paths';

export interface QueryConstraintDescriptor {
  field: string;
  operator: '==';
  value: string;
}

export function activeListingsQueryConstraints(): QueryConstraintDescriptor[] {
  return [{ field: 'status', operator: '==', value: 'active' }];
}

export function sellerListingsQueryConstraints(sellerId: string): QueryConstraintDescriptor[] {
  return [{ field: 'sellerId', operator: '==', value: sellerId }];
}

function toFirestoreWhere({ field, operator, value }: QueryConstraintDescriptor): QueryConstraint {
  return where(field, operator, value);
}

const listingCollection = () =>
  collection(firestoreDb, collections.listings).withConverter(listingConverter);

export function activeListingsQuery() {
  return query(listingCollection(), ...activeListingsQueryConstraints().map(toFirestoreWhere));
}

export function sellerListingsQuery(sellerId: string) {
  return query(listingCollection(), ...sellerListingsQueryConstraints(sellerId).map(toFirestoreWhere));
}

export async function listActiveListings(): Promise<Listing[]> {
  const snapshot = await getDocs(activeListingsQuery());
  return snapshot.docs.map((doc) => doc.data());
}

export async function listSellerListings(sellerId: string): Promise<Listing[]> {
  const snapshot = await getDocs(sellerListingsQuery(sellerId));
  return snapshot.docs.map((doc) => doc.data());
}
```

Create `src/data/firestore/repositories/index.ts`:

```ts
export * from './listingRepository';
```

- [ ] **Step 4: Run tests**

Run:

```bash
VITE_FIREBASE_API_KEY=fake-api-key VITE_FIREBASE_AUTH_DOMAIN=fake-project.firebaseapp.com VITE_FIREBASE_PROJECT_ID=fake-project VITE_FIREBASE_STORAGE_BUCKET=fake-project.appspot.com VITE_FIREBASE_MESSAGING_SENDER_ID=123456789012 VITE_FIREBASE_APP_ID=1:123456789012:web:fakeapp npm test -- src/data/firestore/repositories/listingRepository.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/firestore/repositories
git commit -m "Add listing repository queries"
```

## Task 4: Sale Repository Query Builders

**Files:**
- Create: `src/data/firestore/repositories/saleRepository.ts`
- Modify: `src/data/firestore/repositories/index.ts`
- Test: `src/data/firestore/repositories/saleRepository.test.ts`

**Interfaces:**
- Consumes: `firestoreDb`, `collections`, and `saleConverter`.
- Produces: `sellerSalesQuery(sellerId: string): Query<Sale>`.
- Produces: `listSellerSales(sellerId: string): Promise<Sale[]>`.
- Produces: `sellerSalesQueryConstraints(sellerId: string): QueryConstraintDescriptor[]`.

- [ ] **Step 1: Write failing repository tests**

Create `src/data/firestore/repositories/saleRepository.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sellerSalesQueryConstraints } from './saleRepository';

describe('sale repository query constraints', () => {
  it('filters seller sale records by sellerId', () => {
    expect(sellerSalesQueryConstraints('seller-1')).toEqual([
      { field: 'sellerId', operator: '==', value: 'seller-1' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
VITE_FIREBASE_API_KEY=fake-api-key VITE_FIREBASE_AUTH_DOMAIN=fake-project.firebaseapp.com VITE_FIREBASE_PROJECT_ID=fake-project VITE_FIREBASE_STORAGE_BUCKET=fake-project.appspot.com VITE_FIREBASE_MESSAGING_SENDER_ID=123456789012 VITE_FIREBASE_APP_ID=1:123456789012:web:fakeapp npm test -- src/data/firestore/repositories/saleRepository.test.ts
```

Expected: FAIL because `saleRepository.ts` does not exist.

- [ ] **Step 3: Implement sale repository**

Create `src/data/firestore/repositories/saleRepository.ts` with:

```ts
import { collection, getDocs, query, where, type QueryConstraint } from 'firebase/firestore';
import type { Sale } from '../../../domain/models';
import { saleConverter } from '../converters';
import { firestoreDb } from '../database';
import { collections } from '../paths';
import type { QueryConstraintDescriptor } from './listingRepository';

export function sellerSalesQueryConstraints(sellerId: string): QueryConstraintDescriptor[] {
  return [{ field: 'sellerId', operator: '==', value: sellerId }];
}

function toFirestoreWhere({ field, operator, value }: QueryConstraintDescriptor): QueryConstraint {
  return where(field, operator, value);
}

const saleCollection = () => collection(firestoreDb, collections.sales).withConverter(saleConverter);

export function sellerSalesQuery(sellerId: string) {
  return query(saleCollection(), ...sellerSalesQueryConstraints(sellerId).map(toFirestoreWhere));
}

export async function listSellerSales(sellerId: string): Promise<Sale[]> {
  const snapshot = await getDocs(sellerSalesQuery(sellerId));
  return snapshot.docs.map((doc) => doc.data());
}
```

Modify `src/data/firestore/repositories/index.ts`:

```ts
export * from './listingRepository';
export * from './saleRepository';
```

- [ ] **Step 4: Run tests**

Run:

```bash
VITE_FIREBASE_API_KEY=fake-api-key VITE_FIREBASE_AUTH_DOMAIN=fake-project.firebaseapp.com VITE_FIREBASE_PROJECT_ID=fake-project VITE_FIREBASE_STORAGE_BUCKET=fake-project.appspot.com VITE_FIREBASE_MESSAGING_SENDER_ID=123456789012 VITE_FIREBASE_APP_ID=1:123456789012:web:fakeapp npm test -- src/data/firestore/repositories/saleRepository.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/firestore/repositories
git commit -m "Add sale repository queries"
```

## Task 5: Milestone Documentation and Full Verification

**Files:**
- Modify: `docs/milestones.md`

**Interfaces:**
- Consumes: all model and repository exports from Tasks 1 through 4.
- Produces: Milestone 2 status note in `docs/milestones.md`.

- [ ] **Step 1: Update Milestone 2 docs**

Modify the Milestone 2 section in `docs/milestones.md` by adding:

```md
Status: implemented as model, converter, and repository foundations. Firestore security rules and UI integration are covered by later milestones.
```

- [ ] **Step 2: Run full verification**

Run:

```bash
VITE_FIREBASE_API_KEY=fake-api-key VITE_FIREBASE_AUTH_DOMAIN=fake-project.firebaseapp.com VITE_FIREBASE_PROJECT_ID=fake-project VITE_FIREBASE_STORAGE_BUCKET=fake-project.appspot.com VITE_FIREBASE_MESSAGING_SENDER_ID=123456789012 VITE_FIREBASE_APP_ID=1:123456789012:web:fakeapp npm test
VITE_FIREBASE_API_KEY=fake-api-key VITE_FIREBASE_AUTH_DOMAIN=fake-project.firebaseapp.com VITE_FIREBASE_PROJECT_ID=fake-project VITE_FIREBASE_STORAGE_BUCKET=fake-project.appspot.com VITE_FIREBASE_MESSAGING_SENDER_ID=123456789012 VITE_FIREBASE_APP_ID=1:123456789012:web:fakeapp npm run build
git diff --check
```

Expected: all tests pass, production build passes, and `git diff --check` has no output.

- [ ] **Step 3: Commit**

```bash
git add docs/milestones.md
git commit -m "Document Firestore repository milestone"
```

## Self-Review

### Spec Coverage

- `Card` model: Task 1.
- `Listing` model: Task 1.
- `SellerProfile` model: Task 1.
- `Sale` model: Task 1.
- Firestore converters or equivalent mapping functions: Task 2.
- Repository functions for active listings: Task 3.
- Repository functions for seller listings: Task 3.
- Repository functions for seller sales: Task 4.
- App can read active listings from Firestore: Task 3 provides `listActiveListings()`.
- App can query seller listings: Task 3 provides `listSellerListings(sellerId)`.
- UI does not hard-code Firestore collection paths: Tasks 2 through 4 centralize collection paths and repository functions before UI integration.

### Placeholder Scan

No placeholder markers are intentionally present in this plan.

### Type Consistency

Repository tasks consume the exact converter, database, path, and domain model exports produced by earlier tasks. Query descriptor shape is shared between listing and sale repositories.
