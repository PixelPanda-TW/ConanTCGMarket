import { collection, getDocs } from 'firebase/firestore';
import type { Card } from '../../../domain/models';
import { cardConverter } from '../converters';
import { firestoreDb } from '../database';
import { collections } from '../paths';

const cardCollection = () =>
  collection(firestoreDb, collections.cards).withConverter(cardConverter);

export async function listCards(): Promise<Card[]> {
  const snapshot = await getDocs(cardCollection());
  return snapshot.docs.map((doc) => doc.data());
}

function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, '').toLocaleLowerCase();
}

export function searchCards(cards: readonly Card[], query: string): Card[] {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length === 0) {
    return [...cards];
  }

  return cards.filter((card) =>
    [card.nameZh, card.nameJa]
      .filter((name): name is string => name !== undefined)
      .some((name) => normalizeSearchText(name).includes(normalizedQuery)),
  );
}
