import type { Card } from '../../domain/models';

export interface SellFormState {
  card: Card | null;
  files: File[];
  listingPrice: string;
  quantity: string;
  hasSleeve: boolean;
  supportsMyShip: boolean;
  note: string;
}

export type SellFormErrors = Partial<Record<'card' | 'files' | 'listingPrice' | 'quantity', string>>;

export function normalizeSellForm(values: SellFormState): SellFormState {
  return { ...values, listingPrice: values.listingPrice.trim(), quantity: values.quantity.trim(), note: values.note.trim() };
}

export function validateSellForm(values: SellFormState) {
  const normalizedValues = normalizeSellForm(values);
  const errors: SellFormErrors = {};
  if (!normalizedValues.card) errors.card = '請選擇卡牌。';
  if (normalizedValues.files.length < 1 || normalizedValues.files.length > 3) errors.files = '請選擇 1 到 3 張商品圖片。';
  else if (normalizedValues.files.some((file) => !file.type.startsWith('image/'))) errors.files = '商品圖片必須是圖片檔案。';
  if (!Number.isFinite(Number(normalizedValues.listingPrice)) || Number(normalizedValues.listingPrice) <= 0) errors.listingPrice = '價格必須大於 0。';
  if (!Number.isInteger(Number(normalizedValues.quantity)) || Number(normalizedValues.quantity) <= 0) errors.quantity = '數量必須是大於 0 的整數。';
  return { values: normalizedValues, errors };
}
