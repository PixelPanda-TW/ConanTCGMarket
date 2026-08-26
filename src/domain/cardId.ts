export const CARD_ID_PATTERN = /^(?:\d{4}|P\d{3})$/;
const CARD_ID_QUERY_PATTERN = /^(?:\d{0,4}|P\d{0,3})$/;
const CARD_ID_ERROR = '卡片 ID 請輸入 4 位數字，或 P 加 3 位數字。';

export function normalizeCardId(value: string): string {
  return value.trim().toUpperCase();
}

export function isCompleteCardId(value: string): boolean {
  return CARD_ID_PATTERN.test(value);
}

export function normalizeCardIdQuery(value: string): string {
  return value.trim().toUpperCase();
}

export function validateCardIdQuery(value?: string): string | undefined {
  return CARD_ID_QUERY_PATTERN.test(normalizeCardIdQuery(value ?? '')) ? undefined : CARD_ID_ERROR;
}
