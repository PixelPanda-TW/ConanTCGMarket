import { collection, doc, setDoc } from 'firebase/firestore';
import type { Listing } from '../../../domain/models';
import { auth } from '../../../lib/firebase/app';
import { listingConverter } from '../converters';
import { firestoreDb } from '../database';
import { collections } from '../paths';

const listingCollection = () => collection(firestoreDb, collections.listings);
function assertOwner(sellerId: string) { if (auth.currentUser?.uid !== sellerId) throw new Error('Listing access requires the authenticated seller.'); }
export function createListingId() { return doc(listingCollection()).id; }
export async function createListing(listing: Listing): Promise<string> {
  assertOwner(listing.sellerId);
  await setDoc(doc(firestoreDb, collections.listings, listing.id).withConverter(listingConverter), listing);
  return listing.id;
}
