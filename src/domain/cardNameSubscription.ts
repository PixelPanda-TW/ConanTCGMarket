import type { Card } from './models';

export function isKnownSubscriptionCardName(cards: readonly Card[], value: string): boolean {
  return cards.some((card) => card.cardName === value);
}

export function findCoveringSubscription(
  cardNames: readonly string[],
  targetCardName: string,
): string | undefined {
  return [...cardNames]
    .filter((cardName) => targetCardName.includes(cardName))
    .sort((left, right) => right.length - left.length || left.localeCompare(right, 'zh-Hant'))[0];
}
