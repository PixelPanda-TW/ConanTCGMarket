import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import type { Card } from '../../../domain/models';
import { cardConverter } from '../converters';
import { firestoreDb } from '../database';
import { collections } from '../paths';
export { searchCards } from '../../cards/cardSearch';

const cardCollection = () =>
  collection(firestoreDb, collections.cards).withConverter(cardConverter);

function canonicalIdentity(card: Card): string {
  return JSON.stringify([card.cardType, card.cardName.trim().normalize('NFC'), card.cardId]);
}

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

export function mergeCardsByCanonicalIdentity(cards: readonly Card[]): Card[] {
  const mergedByIdentity = new Map<string, Card>();

  for (const card of cards) {
    const identity = canonicalIdentity(card);
    const current = mergedByIdentity.get(identity);
    if (!current) {
      mergedByIdentity.set(identity, card);
      continue;
    }

    const preferred = current.key === current.cardId && card.key !== card.cardId ? card : current;
    mergedByIdentity.set(identity, {
      ...preferred,
      rarities: [...new Set([...current.rarities, ...card.rarities])].sort(),
    });
  }

  return [...mergedByIdentity.values()].sort(compareCards);
}

export async function listCards(): Promise<Card[]> {
  const snapshot = await getDocs(cardCollection());
  return mergeCardsByCanonicalIdentity(snapshot.docs.map((doc) => doc.data()));
}

export async function getCard(cardKey: string): Promise<Card | null> {
  const snapshot = await getDoc(doc(firestoreDb, collections.cards, cardKey).withConverter(cardConverter));
  return snapshot.exists() ? snapshot.data() : null;
}
