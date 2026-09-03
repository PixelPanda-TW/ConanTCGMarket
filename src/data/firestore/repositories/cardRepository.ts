import { collection, doc, getDoc, getDocs, getDocsFromCache, getDocsFromServer } from 'firebase/firestore';
import type { Card } from '../../../domain/models';
import { cardConverter } from '../converters';
import { firestoreDb } from '../database';
import { collections } from '../paths';
export { searchCards } from '../../cards/cardSearch';

const cardCollection = () =>
  collection(firestoreDb, collections.cards).withConverter(cardConverter);

function compareCards(left: Card, right: Card): number {
  for (const [leftValue, rightValue] of [
    [left.cardId, right.cardId],
    [left.cardType, right.cardType],
    [left.cardName, right.cardName],
    [left.key, right.key],
  ] as const) {
    if (leftValue < rightValue) return -1;
    if (leftValue > rightValue) return 1;
  }

  return 0;
}

function sortCards(cards: readonly Card[]): Card[] {
  return [...cards].sort(compareCards);
}

export async function listCards(): Promise<Card[]> {
  const snapshot = await getDocs(cardCollection());
  return sortCards(snapshot.docs.map((doc) => doc.data()));
}

export async function listCardsFromServer(): Promise<Card[]> {
  const cards = cardCollection();
  try {
    const snapshot = await getDocsFromServer(cards);
    return sortCards(snapshot.docs.map((doc) => doc.data()));
  } catch (serverError) {
    try {
      const cachedSnapshot = await getDocsFromCache(cards);
      if (cachedSnapshot.docs.length > 0) {
        return sortCards(cachedSnapshot.docs.map((doc) => doc.data()));
      }
    } catch {
      // Preserve the server failure below; cache is only a best-effort fallback.
    }
    throw serverError;
  }
}

export async function getCard(cardKey: string): Promise<Card | null> {
  const snapshot = await getDoc(doc(firestoreDb, collections.cards, cardKey).withConverter(cardConverter));
  return snapshot.exists() ? snapshot.data() : null;
}
