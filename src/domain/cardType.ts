export const CARD_TYPES = ['character', 'event', 'case', 'partner'] as const;

export type CardType = typeof CARD_TYPES[number];

export const CARD_TYPE_LABELS: Record<CardType, string> = {
  character: '角色卡',
  event: '事件卡',
  case: 'Case 卡（情境卡）',
  partner: 'Partner 卡（拍檔卡）',
};

export function isCardType(value: unknown): value is CardType {
  return typeof value === 'string' && CARD_TYPES.includes(value as CardType);
}

export function cardTypeLabel(type: CardType): string {
  return CARD_TYPE_LABELS[type];
}
