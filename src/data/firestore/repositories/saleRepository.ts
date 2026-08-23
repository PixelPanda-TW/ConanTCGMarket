import { collection, doc, getDocs, query, runTransaction, where, type QueryConstraint } from 'firebase/firestore';
import type { Listing, Sale } from '../../../domain/models';
import { auth } from '../../../lib/firebase/app';
import { listingConverter, saleConverter } from '../converters';
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

export async function recordSale(listingId: string, quantity: number, soldUnitPrice: number): Promise<Sale> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Sale access requires the authenticated seller.');
  if (!Number.isInteger(quantity) || quantity < 1 || !Number.isFinite(soldUnitPrice) || soldUnitPrice <= 0) throw new Error('Invalid sale values.');
  return runTransaction(firestoreDb, async (transaction) => {
    const listingRef = doc(firestoreDb, collections.listings, listingId).withConverter(listingConverter);
    const listingSnapshot = await transaction.get(listingRef);
    if (!listingSnapshot.exists()) throw new Error('Listing not found.');
    const listing: Listing = listingSnapshot.data();
    if (listing.sellerId !== uid) throw new Error('Only the listing owner can record sales.');
    if (quantity > listing.remainingQuantity) throw new Error('Sale quantity exceeds remaining inventory.');
    const id = doc(collection(firestoreDb, collections.sales)).id; const soldAt = new Date();
    const sale: Sale = { id, listingId, sellerId: uid, cardId: listing.cardId, quantity, listingUnitPrice: listing.listingPrice, soldUnitPrice, soldAt };
    transaction.set(doc(firestoreDb, collections.sales, id).withConverter(saleConverter), sale);
    transaction.update(listingRef, { remainingQuantity: listing.remainingQuantity - quantity, status: listing.remainingQuantity === quantity ? 'sold_out' : 'active', updatedAt: soldAt });
    return sale;
  });
}
