const MAX_CARD_NAMES = 100;
const MAX_CARD_NAME_LENGTH = 100;

export function readSubscriptionCardNames(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_CARD_NAMES) return null;
  const names = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string'
      || item.length === 0
      || item.length > MAX_CARD_NAME_LENGTH
      || item !== item.trim()
      || names.has(item)) return null;
    names.add(item);
  }
  return [...names];
}

export function matchesSubscribedCardName(
  cardNames: readonly string[],
  listingName: string,
): boolean {
  return cardNames.some((cardName) => listingName.includes(cardName));
}
