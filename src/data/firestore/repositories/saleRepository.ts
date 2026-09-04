import { collection, getDocs, query, where, type QueryConstraint } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { validateSale, type ListingStatus, type Sale } from '../../../domain/models';
import { auth, functionsClient } from '../../../lib/firebase/app';
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

export interface RecordSaleResult {
  sale: Sale;
  listing: {
    remainingQuantity: number;
    status: ListingStatus;
    updatedAt: Date;
  };
}

function isExactRecord(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => keys.includes(field));
}

function validTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function readRecordSaleResponse(value: unknown): RecordSaleResult {
  if (!isExactRecord(value, ['sale', 'listing'])
    || !isExactRecord(value.sale, [
      'id', 'listingId', 'sellerId', 'cardId', 'cardType', 'cardName', 'rarity',
      'quantity', 'listingUnitPrice', 'soldUnitPrice', 'soldAt',
    ])
    || !isExactRecord(value.listing, ['remainingQuantity', 'status', 'updatedAt'])
    || !validTimestamp(value.sale.soldAt) || !validTimestamp(value.listing.updatedAt)
    || !Number.isInteger(value.listing.remainingQuantity)
    || (value.listing.remainingQuantity as number) < 0
    || (value.listing.status !== 'active' && value.listing.status !== 'sold_out')
    || (value.listing.status === 'sold_out') !== (value.listing.remainingQuantity === 0)) {
    throw new Error('Server returned an invalid sale response.');
  }
  const sale = { ...value.sale, soldAt: new Date(value.sale.soldAt) } as unknown as Sale;
  try {
    validateSale(sale);
  } catch {
    throw new Error('Server returned an invalid sale response.');
  }
  return {
    sale,
    listing: {
      remainingQuantity: value.listing.remainingQuantity as number,
      status: value.listing.status as ListingStatus,
      updatedAt: new Date(value.listing.updatedAt),
    },
  };
}

export async function recordSale(
  listingId: string,
  quantity: number,
  soldUnitPrice: number,
): Promise<RecordSaleResult> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Sale access requires the authenticated seller.');
  if (!Number.isInteger(quantity) || quantity < 1 || !Number.isFinite(soldUnitPrice) || soldUnitPrice <= 0) throw new Error('Invalid sale values.');
  const callable = httpsCallable<{
    listingId: string; quantity: number; soldUnitPrice: number;
  }, unknown>(functionsClient, 'recordListingSale');
  return readRecordSaleResponse((await callable({ listingId, quantity, soldUnitPrice })).data);
}
