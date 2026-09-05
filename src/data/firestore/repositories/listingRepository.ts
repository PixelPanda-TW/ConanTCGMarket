import { collection, doc, getDoc, getDocs, getDocsFromCache, getDocsFromServer, query, where, type QueryConstraint } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { validateListing, type Listing } from '../../../domain/models';
import { auth, functionsClient } from '../../../lib/firebase/app';
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

export async function listActiveListingsFromServer(): Promise<Listing[]> {
  const listings = activeListingsQuery();
  try {
    const snapshot = await getDocsFromServer(listings);
    return snapshot.docs.map((doc) => doc.data());
  } catch (serverError) {
    try {
      const cachedSnapshot = await getDocsFromCache(listings);
      if (cachedSnapshot.docs.length > 0) {
        return cachedSnapshot.docs.map((doc) => doc.data());
      }
    } catch {
      // Preserve the server failure below; cache is only a best-effort fallback.
    }
    throw serverError;
  }
}

export async function listSellerListings(sellerId: string): Promise<Listing[]> {
  const snapshot = await getDocs(sellerListingsQuery(sellerId));
  return snapshot.docs.map((doc) => doc.data());
}

export async function getListing(id: string): Promise<Listing | null> {
  const snapshot = await getDoc(doc(firestoreDb, collections.listings, id).withConverter(listingConverter));
  return snapshot.exists() ? snapshot.data() : null;
}

function isExactListingWire(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const required = [
    'id', 'sellerId', 'cardId', 'imageUrls',
    'listingPrice', 'originalQuantity', 'remainingQuantity', 'hasSleeve',
    'supportsMyShip', 'status', 'createdAt', 'updatedAt',
  ];
  const optional = new Set([
    'cardType', 'cardName', 'characterName', 'rarity', 'sleeveFee', 'myShipFee', 'note',
    'suspensionActionId', 'suspendedAt',
  ]);
  const keys = Object.keys(value);
  return required.every((field) => keys.includes(field))
    && keys.every((field) => required.includes(field) || optional.has(field));
}


function readListingResponse(value: unknown): Listing {
  if (!isExactListingWire(value)
    || typeof value.createdAt !== 'number' || !Number.isSafeInteger(value.createdAt)
    || typeof value.updatedAt !== 'number' || !Number.isSafeInteger(value.updatedAt)
    || ('suspendedAt' in value
      && (typeof value.suspendedAt !== 'number' || !Number.isSafeInteger(value.suspendedAt)))) {
    throw new Error('Server returned an invalid listing response.');
  }
  const listing = {
    ...value,
    ...(value.cardType === undefined && value.cardName === undefined
      && typeof value.characterName === 'string'
      ? { cardType: 'character', cardName: value.characterName }
      : {}),
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
    ...('suspendedAt' in value ? { suspendedAt: new Date(value.suspendedAt as number) } : {}),
  } as unknown as Listing;
  try {
    validateListing(listing, true);
  } catch {
    throw new Error('Server returned an invalid listing response.');
  }
  return listing;
}

function isSafeImageUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() !== value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || (url.protocol === 'http:'
      && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname));
  } catch {
    return false;
  }
}

export async function updateListing(listing: Listing): Promise<Listing> {
  if (auth.currentUser?.uid !== listing.sellerId) throw new Error('Listing access requires the authenticated seller.');
  const callable = httpsCallable<Record<string, unknown>, unknown>(functionsClient, 'updateSellerListing');
  const response = await callable({
    listingId: listing.id,
    expectedUpdatedAt: listing.updatedAt.valueOf(),
    imageUrls: listing.imageUrls,
    listingPrice: listing.listingPrice,
    hasSleeve: listing.hasSleeve,
    sleeveFee: listing.sleeveFee ?? null,
    supportsMyShip: listing.supportsMyShip,
    myShipFee: listing.myShipFee ?? null,
    note: listing.note ?? null,
  });
  return readListingResponse(response.data);
}

export async function deleteListing(
  listing: Pick<Listing, 'id' | 'sellerId'> & { updatedAt?: Date },
): Promise<string[]> {
  if (auth.currentUser?.uid !== listing.sellerId) throw new Error('Listing access requires the authenticated seller.');
  if (!(listing.updatedAt instanceof Date) || Number.isNaN(listing.updatedAt.valueOf())) {
    throw new Error('Listing deletion requires a valid version.');
  }
  const callable = httpsCallable<{
    listingId: string; expectedUpdatedAt: number;
  }, unknown>(functionsClient, 'deleteUnsoldListing');
  const value = (await callable({
    listingId: listing.id,
    expectedUpdatedAt: listing.updatedAt.valueOf(),
  })).data;
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || Object.keys(value).length !== 1 || !('imageUrls' in value)
    || !Array.isArray(value.imageUrls) || value.imageUrls.length < 1
    || value.imageUrls.length > 3 || !value.imageUrls.every(isSafeImageUrl)) {
    throw new Error('Server returned an invalid listing deletion response.');
  }
  return [...value.imageUrls];
}
