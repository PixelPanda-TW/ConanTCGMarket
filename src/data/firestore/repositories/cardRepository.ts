import { collection, getDocs } from 'firebase/firestore';
import type { Card } from '../../../domain/models';
import { cardConverter } from '../converters';
import { firestoreDb } from '../database';
import { collections } from '../paths';
export { searchCards } from '../../cards/cardSearch';

const cardCollection = () =>
  collection(firestoreDb, collections.cards).withConverter(cardConverter);

export async function listCards(): Promise<Card[]> {
  const snapshot = await getDocs(cardCollection());
  return snapshot.docs.map((doc) => doc.data());
}
