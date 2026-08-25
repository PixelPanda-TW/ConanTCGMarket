export interface Card {
  id: string;
  characterName?: string;
  rarities?: readonly string[];
  /** @deprecated Read-only compatibility for Card Master documents imported before multiple rarities were supported. */
  rarity?: string;
  /** @deprecated Read-only compatibility for pre-migration fixtures and documents. */
  nameZh?: string;
  /** @deprecated Read-only compatibility for pre-migration fixtures and documents. */
  nameJa?: string;
}

export function validateCard(card: Card) {
  if (typeof card.id !== 'string' || !/^\d{4}$/.test(card.id)) {
    throw new Error('Card id must be four digits.');
  }

  if (typeof card.characterName !== 'string' || card.characterName.trim().length === 0) {
    throw new Error('Card requires characterName.');
  }

  const hasRarities = Array.isArray(card.rarities) && card.rarities.length > 0
    && card.rarities.every((rarity) => typeof rarity === 'string' && rarity.trim().length > 0);
  const hasLegacyRarity = typeof card.rarity === 'string' && card.rarity.trim().length > 0;
  if (!hasRarities && !hasLegacyRarity) {
    throw new Error('Card requires rarity.');
  }
}
