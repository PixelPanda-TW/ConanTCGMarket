import { isCompleteCardId } from '../../domain/cardId';
import { isCardType, type CardType } from '../../domain/cardType';
import type { Card, CardMasterEditableFields } from '../../domain/models';

export interface CardMasterAdminFormState {
  cardId: string;
  cardType: CardType;
  cardName: string;
  rarities: string[];
  rationale: string;
}

export type CardMasterAdminFormErrors = Partial<Record<keyof CardMasterAdminFormState, string>>;

export function emptyCardMasterAdminForm(): CardMasterAdminFormState {
  return { cardId: '', cardType: 'character', cardName: '', rarities: [''], rationale: '' };
}

export function cardMasterAdminFormFromCard(card: Card): CardMasterAdminFormState {
  return {
    cardId: card.cardId,
    cardType: card.cardType,
    cardName: card.cardName,
    rarities: [...card.rarities],
    rationale: '',
  };
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

export function validateCardMasterAdminForm(state: CardMasterAdminFormState): {
  values: CardMasterEditableFields & { rationale: string };
  errors: CardMasterAdminFormErrors;
} {
  const cardId = state.cardId.trim().toUpperCase();
  const cardName = state.cardName.trim().normalize('NFC');
  const rarities = Array.from(new Set(state.rarities.map((value) => value.trim().toUpperCase())))
    .sort();
  const rationale = state.rationale.trim();
  const errors: CardMasterAdminFormErrors = {};
  if (!isCompleteCardId(cardId)) errors.cardId = '卡片 ID 必須是四位數字或 P 加三位數字。';
  if (!isCardType(state.cardType)) errors.cardType = '請選擇支援的卡片類型。';
  if (cardName.length < 1 || codePointLength(cardName) > 200) {
    errors.cardName = '卡片名稱須為 1 到 200 字。';
  }
  if (state.rarities.length < 1 || state.rarities.length > 20
    || rarities.some((rarity) => rarity.length < 1 || codePointLength(rarity) > 20)) {
    errors.rarities = '稀有度須有 1 到 20 筆，每筆為 1 到 20 字。';
  }
  if (rationale.length < 1 || codePointLength(rationale) > 500) {
    errors.rationale = '異動原因須為 1 到 500 字。';
  }
  return {
    values: { cardId, cardType: state.cardType, cardName, rarities, rationale },
    errors,
  };
}

export async function cardMasterFingerprint(card: Card): Promise<string> {
  const value = JSON.stringify({
    cardId: card.cardId,
    cardType: card.cardType,
    cardName: card.cardName,
    rarities: card.rarities,
  });
  const hash = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function mergeRarityPreview(
  source: readonly string[],
  target: readonly string[],
): string[] {
  return Array.from(new Set([...target, ...source])).sort();
}

export function validateCardRetirementConfirmation({
  rationale,
  confirmed,
}: {
  rationale: string;
  confirmed: boolean;
}): { rationale: string } | { error: string } {
  const normalized = rationale.trim();
  if (normalized.length < 1) return { error: '請填寫異動原因。' };
  if (Array.from(normalized).length > 500) return { error: '異動原因須為 1 到 500 字。' };
  if (!confirmed) return { error: '請勾選確認後再繼續。' };
  return { rationale: normalized };
}
