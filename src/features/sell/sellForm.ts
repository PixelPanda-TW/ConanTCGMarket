import type { Card } from '../../domain/models';
import { isCardType, type CardType } from '../../domain/cardType';
import { isCompleteCardId, normalizeCardId } from '../../domain/cardId';
import {
  getCardIdsForMetadata,
  getCharacterNameSuggestions,
  getRaritiesForCharacter,
  hasKnownCardMetadata,
} from '../../domain/cardMetadata';

export {
  getCardIdsForMetadata,
  getCharacterNameSuggestions,
  getRaritiesForCharacter,
  hasKnownCardMetadata,
};

export interface SellFormState {
  cardId: string;
  cardType: CardType;
  cardName: string;
  rarity: string;
  files: File[];
  listingPrice: string;
  quantity: string;
  hasSleeve: boolean;
  sleeveFee: string;
  supportsMyShip: boolean;
  myShipFee: string;
  note: string;
}

export type SellFormErrors = Partial<Record<'cardId' | 'cardType' | 'cardName' | 'rarity' | 'files' | 'listingPrice' | 'quantity' | 'sleeveFee' | 'myShipFee', string>>;

export function normalizeSellForm(values: SellFormState): SellFormState {
  return { ...values, cardId: normalizeCardId(values.cardId), cardName: values.cardName.trim().normalize('NFC'), rarity: values.rarity.trim(), listingPrice: values.listingPrice.trim(), quantity: values.quantity.trim(), sleeveFee: values.sleeveFee.trim(), myShipFee: values.myShipFee.trim(), note: values.note.trim() };
}

export function validateSellForm(values: SellFormState) {
  const normalizedValues = normalizeSellForm(values);
  const errors: SellFormErrors = {};
  if (!isCompleteCardId(normalizedValues.cardId)) errors.cardId = '卡片 ID 請輸入 4 位數字，或 P 加 3 位數字。';
  if (!isCardType(normalizedValues.cardType)) errors.cardType = '請選擇卡片類型。';
  if (!normalizedValues.cardName) errors.cardName = '請填寫卡片名稱。';
  if (!normalizedValues.rarity) errors.rarity = '請填寫稀有度。';
  if (normalizedValues.files.length < 1 || normalizedValues.files.length > 3) errors.files = '請選擇 1 到 3 張商品圖片。';
  else if (normalizedValues.files.some((file) => !file.type.startsWith('image/'))) errors.files = '商品圖片必須是圖片檔案。';
  if (!Number.isFinite(Number(normalizedValues.listingPrice)) || Number(normalizedValues.listingPrice) <= 0) errors.listingPrice = '價格必須大於 0。';
  if (!Number.isInteger(Number(normalizedValues.quantity)) || Number(normalizedValues.quantity) <= 0) errors.quantity = '數量必須是大於 0 的整數。';
  if (normalizedValues.hasSleeve) {
    if (!normalizedValues.sleeveFee) errors.sleeveFee = '請填寫包材費。';
    else if (!Number.isFinite(Number(normalizedValues.sleeveFee)) || Number(normalizedValues.sleeveFee) < 0) errors.sleeveFee = '包材費不可小於 0。';
  }
  if (normalizedValues.supportsMyShip) {
    if (!normalizedValues.myShipFee) errors.myShipFee = '請填寫賣貨便加價。';
    else if (!Number.isFinite(Number(normalizedValues.myShipFee)) || Number(normalizedValues.myShipFee) < 0) errors.myShipFee = '賣貨便加價不可小於 0。';
  }
  return { values: normalizedValues, errors };
}

export function hasKnownCharacterName(cards: readonly Card[], characterName: string): boolean {
  return cards.some((card) => card.cardType === 'character' && card.cardName === characterName);
}
