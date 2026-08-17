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
