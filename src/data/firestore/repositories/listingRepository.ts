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
