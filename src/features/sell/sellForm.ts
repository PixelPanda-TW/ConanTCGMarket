export interface SellFormState {
  cardId: string;
  characterName: string;
  rarity: string;
  files: File[];
  listingPrice: string;
  quantity: string;
  hasSleeve: boolean;
  supportsMyShip: boolean;
  note: string;
}

export type SellFormErrors = Partial<Record<'cardId' | 'characterName' | 'rarity' | 'files' | 'listingPrice' | 'quantity', string>>;

export function normalizeSellForm(values: SellFormState): SellFormState {
  return { ...values, cardId: values.cardId.trim(), characterName: values.characterName.trim(), rarity: values.rarity.trim(), listingPrice: values.listingPrice.trim(), quantity: values.quantity.trim(), note: values.note.trim() };
}

export function validateSellForm(values: SellFormState) {
  const normalizedValues = normalizeSellForm(values);
  const errors: SellFormErrors = {};
  if (!/^\d{4}$/.test(normalizedValues.cardId)) errors.cardId = '卡片 ID 必須是 4 位數字。';
  if (!normalizedValues.characterName) errors.characterName = '請填寫角色／人名。';
  if (!normalizedValues.rarity) errors.rarity = '請填寫稀有度。';
  if (normalizedValues.files.length < 1 || normalizedValues.files.length > 3) errors.files = '請選擇 1 到 3 張商品圖片。';
  else if (normalizedValues.files.some((file) => !file.type.startsWith('image/'))) errors.files = '商品圖片必須是圖片檔案。';
  if (!Number.isFinite(Number(normalizedValues.listingPrice)) || Number(normalizedValues.listingPrice) <= 0) errors.listingPrice = '價格必須大於 0。';
  if (!Number.isInteger(Number(normalizedValues.quantity)) || Number(normalizedValues.quantity) <= 0) errors.quantity = '數量必須是大於 0 的整數。';
  return { values: normalizedValues, errors };
}

export function hasKnownCharacterName(cards: readonly Card[], characterName: string): boolean {
  return cards.some((card) => card.characterName === characterName);
}

function cardRarities(card: Card): readonly string[] {
  return card.rarities ?? (card.rarity ? [card.rarity] : []);
}

export function getCharacterNameSuggestions(cards: readonly Card[], query: string): string[] {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return [];

  return [...new Set(cards
    .map((card) => card.characterName)
    .filter((name): name is string => Boolean(name?.startsWith(normalizedQuery))))];
}

export function getRaritiesForCharacter(cards: readonly Card[], characterName: string): string[] {
  if (!characterName.trim()) return [];

  return [...new Set(cards
    .filter((card) => card.characterName === characterName)
    .flatMap(cardRarities))]
    .sort();
}

export function getCardIdsForMetadata(cards: readonly Card[], characterName: string, rarity: string): string[] {
  if (!characterName.trim() || !rarity.trim()) return [];

  return cards
    .filter((card) => card.characterName === characterName && cardRarities(card).includes(rarity))
    .map((card) => card.id)
    .sort((first, second) => first.localeCompare(second));
}

export function hasKnownCardMetadata(cards: readonly Card[], values: Pick<SellFormState, 'cardId' | 'characterName' | 'rarity'>): boolean {
  return cards.some((card) => card.id === values.cardId
    && card.characterName === values.characterName
    && cardRarities(card).includes(values.rarity));
}
import type { Card } from '../../domain/models';
