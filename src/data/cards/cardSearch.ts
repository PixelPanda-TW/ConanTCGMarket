import type { Card } from '../../domain/models';

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
