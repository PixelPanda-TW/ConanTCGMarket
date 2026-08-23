import { collection, doc, getDoc, getDocs, query, setDoc, where, type QueryConstraint } from 'firebase/firestore';
import type { Listing } from '../../../domain/models';
import { auth } from '../../../lib/firebase/app';
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

export async function getListing(id: string): Promise<Listing | null> {
  const snapshot = await getDoc(doc(firestoreDb, collections.listings, id).withConverter(listingConverter));
  return snapshot.exists() ? snapshot.data() : null;
}

export async function updateListing(listing: Listing): Promise<void> {
  if (auth.currentUser?.uid !== listing.sellerId) throw new Error('Listing access requires the authenticated seller.');
  const current = await getListing(listing.id);
  if (!current || current.sellerId !== listing.sellerId || current.cardId !== listing.cardId || current.originalQuantity !== listing.originalQuantity) throw new Error('Listing immutable fields cannot be changed.');
  if (listing.remainingQuantity < current.originalQuantity - current.remainingQuantity) throw new Error('Remaining quantity cannot be less than sold quantity.');
  await setDoc(doc(firestoreDb, collections.listings, listing.id).withConverter(listingConverter), listing);
}
