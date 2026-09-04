import { isCompleteCardId } from '../cardId';
import { isCardType, type CardType } from '../cardType';
import type { Card } from './card';

export const CARD_MASTER_KEY_PATTERN = /^card_[0-9a-f]{64}$/u;
export const CARD_MASTER_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/u;

export type CardMasterArchiveDisposition = 'disabled' | 'superseded' | 'merged';

export interface CardMasterArchive extends Card {
  disposition: CardMasterArchiveDisposition;
  replacementCardKey?: string;
  rationale: string;
  actedBy: string;
  actedAt: Date;
}

export interface CardMasterArchiveCursor {
  actedAt: number;
  key: string;
}

export interface CardMasterArchivePage {
  archives: CardMasterArchive[];
  nextCursor: CardMasterArchiveCursor | null;
}

export interface CardMasterMutationResult {
  card: Card;
  fingerprint: string;
  retiredCardKey?: string | null;
}

function exactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => keys.includes(field));
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

export function validateCardMasterCard(value: unknown): asserts value is Card {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Card Master card must be an object.');
  }
  const card = value as Record<string, unknown>;
  if (!exactFields(card, ['key', 'cardId', 'cardType', 'cardName', 'rarities'])
    || typeof card.key !== 'string' || !CARD_MASTER_KEY_PATTERN.test(card.key)
    || typeof card.cardId !== 'string' || !isCompleteCardId(card.cardId)
    || !isCardType(card.cardType)
    || typeof card.cardName !== 'string' || card.cardName.length < 1
    || codePointLength(card.cardName) > 200
    || card.cardName !== card.cardName.trim().normalize('NFC')
    || !Array.isArray(card.rarities) || card.rarities.length < 1 || card.rarities.length > 20) {
    throw new Error('Card Master card is invalid.');
  }
  const rarities = card.rarities as unknown[];
  if (rarities.some((rarity) => typeof rarity !== 'string'
    || rarity.length < 1 || codePointLength(rarity) > 20
    || rarity !== rarity.trim().toUpperCase())
    || new Set(rarities).size !== rarities.length
    || [...rarities].sort().some((rarity, index) => rarity !== rarities[index])) {
    throw new Error('Card Master card rarities are invalid.');
  }
}

export function validateCardMasterArchive(value: unknown): asserts value is CardMasterArchive {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Card Master archive must be an object.');
  }
  const archive = value as Record<string, unknown>;
  const needsReplacement = archive.disposition === 'superseded' || archive.disposition === 'merged';
  const fields = [
    'key', 'cardId', 'cardType', 'cardName', 'rarities', 'disposition',
    ...(needsReplacement ? ['replacementCardKey'] : []),
    'rationale', 'actedBy', 'actedAt',
  ];
  if (!['disabled', 'superseded', 'merged'].includes(String(archive.disposition))
    || !exactFields(archive, fields)) {
    throw new Error('Card Master archive fields are invalid.');
  }
  try {
    validateCardMasterCard(Object.fromEntries(
      ['key', 'cardId', 'cardType', 'cardName', 'rarities'].map((field) => [field, archive[field]]),
    ));
  } catch {
    throw new Error('Card Master archive card is invalid.');
  }
  if (typeof archive.rationale !== 'string'
    || archive.rationale !== archive.rationale.trim()
    || codePointLength(archive.rationale) < 1 || codePointLength(archive.rationale) > 500
    || typeof archive.actedBy !== 'string'
    || archive.actedBy !== archive.actedBy.trim()
    || archive.actedBy.length < 1 || archive.actedBy.length > 128
    || !(archive.actedAt instanceof Date) || Number.isNaN(archive.actedAt.valueOf())) {
    throw new Error('Card Master archive metadata is invalid.');
  }
  if (needsReplacement
    && (typeof archive.replacementCardKey !== 'string'
      || !CARD_MASTER_KEY_PATTERN.test(archive.replacementCardKey)
      || archive.replacementCardKey === archive.key)) {
    throw new Error('Card Master archive replacement is invalid.');
  }
}

export function isCardMasterArchiveCursor(value: unknown): value is CardMasterArchiveCursor {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const cursor = value as Record<string, unknown>;
  return exactFields(cursor, ['actedAt', 'key'])
    && Number.isSafeInteger(cursor.actedAt) && (cursor.actedAt as number) >= 0
    && typeof cursor.key === 'string' && CARD_MASTER_KEY_PATTERN.test(cursor.key);
}

export type CardMasterEditableFields = {
  cardId: string;
  cardType: CardType;
  cardName: string;
  rarities: string[];
};
