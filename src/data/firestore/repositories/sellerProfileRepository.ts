import { doc, getDoc, setDoc } from 'firebase/firestore';
import type { SellerProfile } from '../../../domain/models';
import { auth } from '../../../lib/firebase/app';
import { sellerProfileConverter } from '../converters';
import { firestoreDb } from '../database';
import { collections } from '../paths';

const sellerProfileDocument = (uid: string) =>
  doc(firestoreDb, collections.sellerProfiles, uid).withConverter(sellerProfileConverter);

function assertAuthenticatedSeller(uid: string) {
  if (auth.currentUser?.uid !== uid) {
    throw new Error('Seller profile access requires the authenticated seller.');
  }
}

export async function getSellerProfile(uid: string): Promise<SellerProfile | null> {
  assertAuthenticatedSeller(uid);
  const snapshot = await getDoc(sellerProfileDocument(uid));
  return snapshot.exists() ? snapshot.data() : null;
}

export async function saveSellerProfile(profile: SellerProfile): Promise<void> {
  assertAuthenticatedSeller(profile.uid);
  await setDoc(sellerProfileDocument(profile.uid), profile);
}
