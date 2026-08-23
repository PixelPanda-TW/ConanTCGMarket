export interface ImportedCard {
  cardId: string;
  characterName: string;
  rarity: string;
}

const fields = new Set(['cardId', 'characterName', 'rarity']);
export function validateCardImport(input: unknown): ImportedCard[] {
  if (!Array.isArray(input)) throw new Error('Invalid card master input.');
  const ids = new Set<string>();
  return input.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid card master input.');
    const card = value as Record<string, unknown>;
    if (Object.keys(card).some((key) => !fields.has(key)) || typeof card.cardId !== 'string' || !/^\d{4}$/.test(card.cardId) || ids.has(card.cardId) || typeof card.characterName !== 'string' || !card.characterName.trim() || typeof card.rarity !== 'string' || !card.rarity.trim()) throw new Error('Invalid card master input.');
    ids.add(card.cardId);
    return { cardId: card.cardId, characterName: card.characterName.trim(), rarity: card.rarity.trim() };
  });
}
