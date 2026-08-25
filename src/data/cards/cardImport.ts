export interface ImportedCard {
  cardId: string;
  characterName: string;
  rarities: string[];
}

const fields = new Set(['cardId', 'characterName', 'rarities']);
export function validateCardImport(input: unknown): ImportedCard[] {
  if (!Array.isArray(input)) throw new Error('Invalid card master input.');
  const ids = new Set<string>();
  return input.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid card master input.');
    const card = value as Record<string, unknown>;
    if (Object.keys(card).some((key) => !fields.has(key)) || typeof card.cardId !== 'string' || !/^\d{4}$/.test(card.cardId) || ids.has(card.cardId) || typeof card.characterName !== 'string' || !card.characterName.trim() || !Array.isArray(card.rarities) || card.rarities.length === 0 || card.rarities.some((rarity) => typeof rarity !== 'string' || !rarity.trim())) throw new Error('Invalid card master input.');
    ids.add(card.cardId);
    return { cardId: card.cardId, characterName: card.characterName.trim(), rarities: Array.from(new Set(card.rarities.map((rarity) => rarity.trim()))) };
  });
}
