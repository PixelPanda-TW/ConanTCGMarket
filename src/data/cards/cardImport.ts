export interface ImportedCard {
  cardId: string;
  nameZh?: string;
  nameJa?: string;
  rarity: string;
}

const fields = new Set(['cardId', 'nameZh', 'nameJa', 'rarity']);
export function validateCardImport(input: unknown): ImportedCard[] {
  if (!Array.isArray(input)) throw new Error('Invalid card master input.');
  const ids = new Set<string>();
  return input.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid card master input.');
    const card = value as Record<string, unknown>;
    if (Object.keys(card).some((key) => !fields.has(key)) || typeof card.cardId !== 'string' || !card.cardId || ids.has(card.cardId) || typeof card.rarity !== 'string' || !card.rarity || (card.nameZh !== undefined && typeof card.nameZh !== 'string') || (card.nameJa !== undefined && typeof card.nameJa !== 'string') || (!card.nameZh && !card.nameJa)) throw new Error('Invalid card master input.');
    ids.add(card.cardId);
    return { cardId: card.cardId, rarity: card.rarity, ...(card.nameZh ? { nameZh: card.nameZh } : {}), ...(card.nameJa ? { nameJa: card.nameJa } : {}) };
  });
}
