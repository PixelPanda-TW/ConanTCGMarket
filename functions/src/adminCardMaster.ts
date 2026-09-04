import { createHash } from 'node:crypto';

export type CardType = 'character' | 'event' | 'case' | 'partner';
export type ArchiveDisposition = 'disabled' | 'superseded' | 'merged';
type ErrorCode =
  | 'unauthenticated'
  | 'permission-denied'
  | 'invalid-argument'
  | 'not-found'
  | 'already-exists'
  | 'failed-precondition'
  | 'aborted'
  | 'unavailable';

export interface ApprovedCard {
  cardId: string;
  cardType: CardType;
  cardName: string;
  rarities: string[];
}

export interface CardMasterArchive extends ApprovedCard {
  disposition: ArchiveDisposition;
  replacementCardKey?: string;
  rationale: string;
  actedBy: string;
  actedAt: Date;
}

export type CardMasterAudit = {
  action: 'add' | 'edit' | 'disable' | 'merge';
  sourceCardKey?: string;
  targetCardKey?: string;
  before?: ApprovedCard;
  targetBefore?: ApprovedCard;
  after?: ApprovedCard;
  rationale: string;
  actedBy: string;
  actedAt: Date;
};

export class AdminCardMasterError extends Error {
  constructor(public readonly code: ErrorCode, message: string) {
    super(message);
    this.name = 'AdminCardMasterError';
  }
}

export interface AdminCardMasterTransaction {
  getAccountAccess(uid: string): Promise<unknown | null>;
  getCard(key: string): Promise<Record<string, unknown> | null>;
  getArchive(key: string): Promise<Record<string, unknown> | null>;
  setCard(key: string, data: ApprovedCard): void;
  deleteCard(key: string): void;
  createArchive(key: string, data: CardMasterArchive): void;
  createAudit(key: string, data: CardMasterAudit): void;
}

export interface AdminCardMasterDependencies {
  now(): Date;
  randomId(): string;
  runTransaction<T>(
    operation: (transaction: AdminCardMasterTransaction) => Promise<T>,
  ): Promise<T>;
}

interface AdminRequest {
  authUid: string | null;
  adminClaim: unknown;
  data: unknown;
}

const CARD_ID_PATTERN = /^(?:\d{4}|P\d{3})$/u;
const CARD_KEY_PATTERN = /^card_[0-9a-f]{64}$/u;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/u;
const cardTypes = new Set<CardType>(['character', 'event', 'case', 'partner']);
const cardFields = ['cardId', 'cardType', 'cardName', 'rarities'] as const;

function invalidArgument(message = '請檢查卡片資料。'): never {
  throw new AdminCardMasterError('invalid-argument', message);
}

function exactObject(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalidArgument();
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== fields.length || !fields.every((field) => keys.includes(field))) invalidArgument();
  return record;
}

function exactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => keys.includes(field));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

export function normalizeAdminCard(value: unknown): ApprovedCard {
  const record = exactObject(value, cardFields);
  if (typeof record.cardId !== 'string' || typeof record.cardName !== 'string'
    || !cardTypes.has(record.cardType as CardType) || !Array.isArray(record.rarities)) invalidArgument();
  const cardId = record.cardId.trim().toUpperCase();
  const cardName = record.cardName.trim().normalize('NFC');
  if (!CARD_ID_PATTERN.test(cardId) || cardName.length === 0 || codePointLength(cardName) > 200
    || record.rarities.length < 1 || record.rarities.length > 20) invalidArgument();
  const rarities = record.rarities.map((rarity) => {
    if (typeof rarity !== 'string') invalidArgument();
    const normalized = rarity.trim().toUpperCase();
    if (normalized.length === 0 || codePointLength(normalized) > 20) invalidArgument();
    return normalized;
  });
  return {
    cardId,
    cardType: record.cardType as CardType,
    cardName,
    rarities: Array.from(new Set(rarities)).sort(compareText),
  };
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function cardMasterKey(card: ApprovedCard): string {
  return `card_${digest(JSON.stringify([card.cardType, card.cardName, card.cardId]))}`;
}

export function cardFingerprint(card: ApprovedCard): string {
  return digest(JSON.stringify({
    cardId: card.cardId,
    cardType: card.cardType,
    cardName: card.cardName,
    rarities: card.rarities,
  }));
}

function canonicalStoredCard(raw: Record<string, unknown> | null, key: string): ApprovedCard {
  if (!raw) {
    throw new AdminCardMasterError('not-found', `找不到卡片 ${key}。`);
  }
  if (!exactFields(raw, cardFields)) {
    throw new AdminCardMasterError('failed-precondition', `卡片 ${key} 的資料不完整。`);
  }
  let normalized: ApprovedCard;
  try {
    normalized = normalizeAdminCard(raw);
  } catch {
    throw new AdminCardMasterError('failed-precondition', `卡片 ${key} 的資料不完整。`);
  }
  if (!sameCardValue(normalized, raw) || cardMasterKey(normalized) !== key) {
    throw new AdminCardMasterError('failed-precondition', `卡片 ${key} 不是 canonical 資料。`);
  }
  return normalized;
}

function sameCardValue(card: ApprovedCard, value: Record<string, unknown>): boolean {
  return value.cardId === card.cardId
    && value.cardType === card.cardType
    && value.cardName === card.cardName
    && Array.isArray(value.rarities)
    && value.rarities.length === card.rarities.length
    && value.rarities.every((rarity, index) => rarity === card.rarities[index]);
}

function parseRationale(value: unknown): string {
  if (typeof value !== 'string') invalidArgument('請填寫異動原因。');
  const rationale = value.trim();
  if (rationale.length === 0 || codePointLength(rationale) > 500) invalidArgument('異動原因須為 1 到 500 字。');
  return rationale;
}

function parseCardKey(value: unknown): string {
  if (typeof value !== 'string' || !CARD_KEY_PATTERN.test(value)) invalidArgument('卡片 key 格式錯誤。');
  return value;
}

function parseFingerprint(value: unknown): string {
  if (typeof value !== 'string' || !FINGERPRINT_PATTERN.test(value)) invalidArgument('卡片版本格式錯誤。');
  return value;
}

function requireAdmin(request: AdminRequest): string {
  if (typeof request.authUid !== 'string' || request.authUid.length < 1
    || request.authUid.length > 128 || request.authUid.trim() !== request.authUid) {
    throw new AdminCardMasterError('unauthenticated', '請先使用 Google 登入。');
  }
  if (request.adminClaim !== true) {
    throw new AdminCardMasterError('permission-denied', '無權限使用管理工具。');
  }
  return request.authUid;
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.valueOf());
}

function isCanonicalActiveAccess(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const access = value as Record<string, unknown>;
  return exactFields(access, ['status', 'confirmedViolationCount', 'updatedAt'])
    && access.status === 'active'
    && Number.isInteger(access.confirmedViolationCount)
    && (access.confirmedViolationCount as number) >= 0
    && validDate(access.updatedAt);
}

async function requireActiveAdmin(
  transaction: AdminCardMasterTransaction,
  uid: string,
): Promise<void> {
  const access = await transaction.getAccountAccess(uid);
  if (access !== null && !isCanonicalActiveAccess(access)) {
    throw new AdminCardMasterError('permission-denied', '此帳號目前無法使用管理工具。');
  }
}

function canonicalArchive(raw: Record<string, unknown> | null, key: string): CardMasterArchive | null {
  if (!raw) return null;
  const disposition = raw.disposition;
  const requiresReplacement = disposition === 'superseded' || disposition === 'merged';
  const fields = [
    ...cardFields, 'disposition', ...(requiresReplacement ? ['replacementCardKey'] : []),
    'rationale', 'actedBy', 'actedAt',
  ];
  if (!['disabled', 'superseded', 'merged'].includes(String(disposition))
    || !exactFields(raw, fields)) {
    throw new AdminCardMasterError('failed-precondition', `封存卡片 ${key} 的資料不完整。`);
  }
  let card: ApprovedCard;
  try { card = normalizeAdminCard(Object.fromEntries(cardFields.map((field) => [field, raw[field]]))); }
  catch { throw new AdminCardMasterError('failed-precondition', `封存卡片 ${key} 的資料不完整。`); }
  let rationale: string;
  try { rationale = parseRationale(raw.rationale); }
  catch { throw new AdminCardMasterError('failed-precondition', `封存卡片 ${key} 的資料不完整。`); }
  if (!sameCardValue(card, raw)
    || cardMasterKey(card) !== key
    || rationale !== raw.rationale
    || typeof raw.actedBy !== 'string' || raw.actedBy.length < 1 || raw.actedBy.trim() !== raw.actedBy
    || !validDate(raw.actedAt)
    || (requiresReplacement && (typeof raw.replacementCardKey !== 'string'
      || !CARD_KEY_PATTERN.test(raw.replacementCardKey)))) {
    throw new AdminCardMasterError('failed-precondition', `封存卡片 ${key} 的資料不完整。`);
  }
  return raw as unknown as CardMasterArchive;
}

function currentTime(dependencies: AdminCardMasterDependencies): Date {
  const now = dependencies.now();
  if (!validDate(now)) throw new AdminCardMasterError('unavailable', '管理服務暫時無法使用。');
  return now;
}

function auditId(dependencies: AdminCardMasterDependencies): string {
  const id = dependencies.randomId();
  if (typeof id !== 'string' || id.length < 1 || id.length > 128 || id.trim() !== id) {
    throw new AdminCardMasterError('unavailable', '管理服務暫時無法使用。');
  }
  return id;
}

function cardResult(key: string, card: ApprovedCard, retiredCardKey: string | null | undefined = undefined) {
  return {
    card: { key, ...card },
    fingerprint: cardFingerprint(card),
    ...(retiredCardKey === undefined ? {} : { retiredCardKey }),
  };
}

function cardFromInput(input: Record<string, unknown>): ApprovedCard {
  return normalizeAdminCard(Object.fromEntries(cardFields.map((field) => [field, input[field]])));
}

export async function handleAddCardMasterEntry(
  request: AdminRequest,
  dependencies: AdminCardMasterDependencies,
) {
  const uid = requireAdmin(request);
  const input = exactObject(request.data, [...cardFields, 'rationale']);
  const card = cardFromInput(input);
  const rationale = parseRationale(input.rationale);
  const key = cardMasterKey(card);
  const now = currentTime(dependencies);
  const id = auditId(dependencies);
  return dependencies.runTransaction(async (transaction) => {
    await requireActiveAdmin(transaction, uid);
    if (await transaction.getCard(key)) {
      throw new AdminCardMasterError('already-exists', '這筆卡片已存在。');
    }
    if (canonicalArchive(await transaction.getArchive(key), key)) {
      throw new AdminCardMasterError('already-exists', '這筆卡片已停用或被取代。');
    }
    transaction.setCard(key, card);
    transaction.createAudit(id, {
      action: 'add', targetCardKey: key, after: card, rationale, actedBy: uid, actedAt: now,
    });
    return cardResult(key, card);
  });
}

export async function handleEditCardMasterEntry(
  request: AdminRequest,
  dependencies: AdminCardMasterDependencies,
) {
  const uid = requireAdmin(request);
  const input = exactObject(request.data, [
    'sourceCardKey', 'expectedFingerprint', ...cardFields, 'rationale',
  ]);
  const sourceKey = parseCardKey(input.sourceCardKey);
  const expectedFingerprint = parseFingerprint(input.expectedFingerprint);
  const after = cardFromInput(input);
  const rationale = parseRationale(input.rationale);
  const targetKey = cardMasterKey(after);
  const now = currentTime(dependencies);
  const id = auditId(dependencies);
  return dependencies.runTransaction(async (transaction) => {
    await requireActiveAdmin(transaction, uid);
    const before = canonicalStoredCard(await transaction.getCard(sourceKey), sourceKey);
    if (cardFingerprint(before) !== expectedFingerprint) {
      throw new AdminCardMasterError('aborted', '卡片已被更新，請重新載入。');
    }
    if (targetKey !== sourceKey) {
      if (await transaction.getCard(targetKey)) {
        throw new AdminCardMasterError('already-exists', '修改後的卡片已存在。');
      }
      if (canonicalArchive(await transaction.getArchive(targetKey), targetKey)) {
        throw new AdminCardMasterError('already-exists', '修改後的卡片 key 已被封存。');
      }
      if (canonicalArchive(await transaction.getArchive(sourceKey), sourceKey)) {
        throw new AdminCardMasterError('failed-precondition', '來源卡片已有封存紀錄。');
      }
      transaction.setCard(targetKey, after);
      transaction.createArchive(sourceKey, {
        ...before, disposition: 'superseded', replacementCardKey: targetKey,
        rationale, actedBy: uid, actedAt: now,
      });
      transaction.deleteCard(sourceKey);
    } else {
      transaction.setCard(sourceKey, after);
    }
    transaction.createAudit(id, {
      action: 'edit', sourceCardKey: sourceKey, targetCardKey: targetKey,
      before, after, rationale, actedBy: uid, actedAt: now,
    });
    return cardResult(targetKey, after, targetKey === sourceKey ? null : sourceKey);
  });
}

export async function handleDisableCardMasterEntry(
  request: AdminRequest,
  dependencies: AdminCardMasterDependencies,
) {
  const uid = requireAdmin(request);
  const input = exactObject(request.data, ['sourceCardKey', 'expectedFingerprint', 'rationale']);
  const sourceKey = parseCardKey(input.sourceCardKey);
  const expectedFingerprint = parseFingerprint(input.expectedFingerprint);
  const rationale = parseRationale(input.rationale);
  const now = currentTime(dependencies);
  const id = auditId(dependencies);
  return dependencies.runTransaction(async (transaction) => {
    await requireActiveAdmin(transaction, uid);
    const before = canonicalStoredCard(await transaction.getCard(sourceKey), sourceKey);
    if (cardFingerprint(before) !== expectedFingerprint) {
      throw new AdminCardMasterError('aborted', '卡片已被更新，請重新載入。');
    }
    if (canonicalArchive(await transaction.getArchive(sourceKey), sourceKey)) {
      throw new AdminCardMasterError('failed-precondition', '來源卡片已有封存紀錄。');
    }
    const archive: CardMasterArchive = {
      ...before, disposition: 'disabled', rationale, actedBy: uid, actedAt: now,
    };
    transaction.createArchive(sourceKey, archive);
    transaction.deleteCard(sourceKey);
    transaction.createAudit(id, {
      action: 'disable', sourceCardKey: sourceKey, before,
      rationale, actedBy: uid, actedAt: now,
    });
    return { archived: { key: sourceKey, ...archive, actedAt: now.valueOf() } };
  });
}

export async function handleMergeCardMasterEntries(
  request: AdminRequest,
  dependencies: AdminCardMasterDependencies,
) {
  const uid = requireAdmin(request);
  const input = exactObject(request.data, [
    'sourceCardKey', 'sourceExpectedFingerprint', 'targetCardKey',
    'targetExpectedFingerprint', 'rationale',
  ]);
  const sourceKey = parseCardKey(input.sourceCardKey);
  const targetKey = parseCardKey(input.targetCardKey);
  if (sourceKey === targetKey) invalidArgument('來源與合併目標不可相同。');
  const sourceExpectedFingerprint = parseFingerprint(input.sourceExpectedFingerprint);
  const targetExpectedFingerprint = parseFingerprint(input.targetExpectedFingerprint);
  const rationale = parseRationale(input.rationale);
  const now = currentTime(dependencies);
  const id = auditId(dependencies);
  return dependencies.runTransaction(async (transaction) => {
    await requireActiveAdmin(transaction, uid);
    const source = canonicalStoredCard(await transaction.getCard(sourceKey), sourceKey);
    const target = canonicalStoredCard(await transaction.getCard(targetKey), targetKey);
    if (cardFingerprint(source) !== sourceExpectedFingerprint
      || cardFingerprint(target) !== targetExpectedFingerprint) {
      throw new AdminCardMasterError('aborted', '來源或目標卡片已被更新，請重新載入。');
    }
    if (canonicalArchive(await transaction.getArchive(sourceKey), sourceKey)) {
      throw new AdminCardMasterError('failed-precondition', '來源卡片已有封存紀錄。');
    }
    const after: ApprovedCard = {
      ...target,
      rarities: Array.from(new Set([...target.rarities, ...source.rarities])).sort(compareText),
    };
    transaction.setCard(targetKey, after);
    transaction.createArchive(sourceKey, {
      ...source, disposition: 'merged', replacementCardKey: targetKey,
      rationale, actedBy: uid, actedAt: now,
    });
    transaction.deleteCard(sourceKey);
    transaction.createAudit(id, {
      action: 'merge', sourceCardKey: sourceKey, targetCardKey: targetKey,
      before: source, targetBefore: target, after,
      rationale, actedBy: uid, actedAt: now,
    });
    return cardResult(targetKey, after, sourceKey);
  });
}
