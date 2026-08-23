import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
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

export async function getCard(cardId: string): Promise<Card | null> {
  const snapshot = await getDoc(doc(firestoreDb, collections.cards, cardId).withConverter(cardConverter));
  return snapshot.exists() ? snapshot.data() : null;
}
