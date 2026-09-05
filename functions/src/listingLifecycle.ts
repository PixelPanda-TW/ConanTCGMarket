type CardType = 'character' | 'event' | 'case' | 'partner';
type ListingStatus = 'active' | 'sold_out' | 'suspended';
type ErrorCode =
  | 'unauthenticated'
  | 'permission-denied'
  | 'invalid-argument'
  | 'not-found'
  | 'failed-precondition'
  | 'aborted'
  | 'unavailable';

export class ListingLifecycleError extends Error {
  constructor(public readonly code: ErrorCode, message: string) {
    super(message);
    this.name = 'ListingLifecycleError';
  }
}

export interface StoredListing {
  sellerId: string;
  cardId: string;
  cardType?: CardType;
  cardName?: string;
  characterName?: string;
  rarity?: string;
  imageUrls: string[];
  listingPrice: number;
  originalQuantity: number;
  remainingQuantity: number;
  hasSleeve: boolean;
  sleeveFee?: number;
  supportsMyShip: boolean;
  myShipFee?: number;
  note?: string;
  status: ListingStatus;
  suspensionActionId?: string;
  suspendedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface StoredSale {
  listingId: string;
  sellerId: string;
  cardId: string;
  cardType: CardType;
  cardName: string;
  rarity: string;
  quantity: number;
  listingUnitPrice: number;
  soldUnitPrice: number;
  soldAt: Date;
}

export interface ListingPatch {
  imageUrls: string[];
  listingPrice: number;
  hasSleeve: boolean;
  sleeveFee: number | null;
  supportsMyShip: boolean;
  myShipFee: number | null;
  note: string | null;
  updatedAt: Date;
}

export interface ListingAvailabilityPatch {
  remainingQuantity: number;
  status: ListingStatus;
  updatedAt: Date;
}

export type ListingMutation = ListingPatch | ListingAvailabilityPatch;

export interface ListingLifecycleTransaction {
  getAccountAccess(uid: string): Promise<unknown | null>;
  getListing(id: string): Promise<Record<string, unknown> | null>;
  hasSaleForListing(id: string): Promise<boolean>;
  createSale(id: string, data: StoredSale): void;
  updateListing(id: string, patch: ListingMutation): void;
  deleteListing(id: string): void;
}

export interface ListingLifecycleDependencies {
  now(): Date;
  randomId(): string;
  runTransaction<T>(
    operation: (transaction: ListingLifecycleTransaction) => Promise<T>,
  ): Promise<T>;
}

interface CallableRequest {
  authUid: string | null;
  data: unknown;
}

const cardTypes = new Set<CardType>(['character', 'event', 'case', 'partner']);
function isCardType(value: unknown): value is CardType {
  return cardTypes.has(value as CardType);
}
const requiredListingFields = [
  'sellerId', 'cardId', 'imageUrls', 'listingPrice',
  'originalQuantity', 'remainingQuantity', 'hasSleeve', 'supportsMyShip', 'status',
  'createdAt', 'updatedAt',
] as const;
const optionalListingFields = new Set([
  'cardType', 'cardName', 'characterName', 'rarity', 'sleeveFee', 'myShipFee', 'note',
  'suspensionActionId', 'suspendedAt',
]);

function invalidArgument(message = '請檢查輸入資料。'): never {
  throw new ListingLifecycleError('invalid-argument', message);
}

function assertExactObject(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalidArgument();
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== fields.length || !fields.every((field) => keys.includes(field))) invalidArgument();
  return record;
}

function requireAuthUid(value: string | null): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128 || value.trim() !== value) {
    throw new ListingLifecycleError('unauthenticated', '請先使用 Google 登入。');
  }
  return value;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.valueOf());
}

function isCanonicalActiveAccess(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const access = value as Record<string, unknown>;
  const keys = Object.keys(access);
  return keys.length === 3
    && ['status', 'confirmedViolationCount', 'updatedAt'].every((field) => keys.includes(field))
    && access.status === 'active'
    && Number.isInteger(access.confirmedViolationCount)
    && (access.confirmedViolationCount as number) >= 0
    && isValidDate(access.updatedAt);
}

async function requireActiveAccount(transaction: ListingLifecycleTransaction, uid: string) {
  const access = await transaction.getAccountAccess(uid);
  if (access !== null && !isCanonicalActiveAccess(access)) {
    throw new ListingLifecycleError('permission-denied', '此帳號目前無法執行這項操作。');
  }
}

function hasTrimmedText(value: unknown, max = 1000): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= max && value.trim() === value;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function readImageUrls(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) return null;
  const urls = value.every((item) => {
    if (typeof item !== 'string' || item !== item.trim()) return false;
    try {
      const url = new URL(item);
      return url.protocol === 'https:' || (url.protocol === 'http:'
        && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname));
    } catch {
      return false;
    }
  });
  return urls ? [...value] as string[] : null;
}

function readOptionalFee(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  return isNonNegativeNumber(value) ? value : null;
}

export function readStoredListing(value: Record<string, unknown> | null): StoredListing | null {
  if (!value) return null;
  const keys = Object.keys(value);
  if (!requiredListingFields.every((field) => keys.includes(field))
    || keys.some((field) => !requiredListingFields.includes(field as never)
      && !optionalListingFields.has(field))) return null;
  const imageUrls = readImageUrls(value.imageUrls);
  const sleeveFee = readOptionalFee(value.sleeveFee);
  const myShipFee = readOptionalFee(value.myShipFee);
  const hasNormalizedMetadata = value.cardType !== undefined || value.cardName !== undefined;
  const validStatus = value.remainingQuantity === 0
    ? value.status === 'sold_out'
      && value.suspensionActionId === undefined && value.suspendedAt === undefined
    : value.status === 'active'
      ? value.suspensionActionId === undefined && value.suspendedAt === undefined
      : value.status === 'suspended'
        && hasTrimmedText(value.suspensionActionId, 200)
        && isValidDate(value.suspendedAt)
        && isValidDate(value.updatedAt)
        && (value.suspendedAt as Date).valueOf() <= (value.updatedAt as Date).valueOf();
  if (!hasTrimmedText(value.sellerId, 128)
    || !hasTrimmedText(value.cardId, 32)
    || !imageUrls
    || !isPositiveNumber(value.listingPrice)
    || !Number.isInteger(value.originalQuantity) || (value.originalQuantity as number) < 1
    || !Number.isInteger(value.remainingQuantity) || (value.remainingQuantity as number) < 0
    || (value.remainingQuantity as number) > (value.originalQuantity as number)
    || typeof value.hasSleeve !== 'boolean'
    || typeof value.supportsMyShip !== 'boolean'
    || !validStatus
    || !isValidDate(value.createdAt) || !isValidDate(value.updatedAt)
    || sleeveFee === null || myShipFee === null
    || (!value.hasSleeve && sleeveFee !== undefined)
    || (!value.supportsMyShip && myShipFee !== undefined)
    || (value.note !== undefined && !hasTrimmedText(value.note, 2000))) return null;
  if (hasNormalizedMetadata) {
    if (!isCardType(value.cardType)
      || !hasTrimmedText(value.cardName, 200)
      || !hasTrimmedText(value.rarity, 100)) return null;
    if (value.cardType === 'character') {
      if (value.characterName !== value.cardName) return null;
    } else if (value.characterName !== undefined) return null;
  } else if ((value.characterName !== undefined && !hasTrimmedText(value.characterName, 200))
    || (value.rarity !== undefined && !hasTrimmedText(value.rarity, 100))) return null;
  return {
    ...value,
    sellerId: value.sellerId,
    cardId: value.cardId,
    imageUrls,
    listingPrice: value.listingPrice,
    originalQuantity: value.originalQuantity as number,
    remainingQuantity: value.remainingQuantity as number,
    hasSleeve: value.hasSleeve,
    supportsMyShip: value.supportsMyShip,
    status: value.status,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  } as StoredListing;
}

function parseListingId(value: unknown): string {
  if (!hasTrimmedText(value, 128)) invalidArgument('商品 ID 格式錯誤。');
  return value;
}

async function readOwnedActiveListing(
  transaction: ListingLifecycleTransaction,
  listingId: string,
  uid: string,
  allowHeld = false,
): Promise<StoredListing> {
  const raw = await transaction.getListing(listingId);
  if (raw === null) throw new ListingLifecycleError('not-found', '找不到商品。');
  const listing = readStoredListing(raw);
  if (!listing) throw new ListingLifecycleError('failed-precondition', '商品資料不完整，無法操作。');
  if (listing.sellerId !== uid) {
    throw new ListingLifecycleError('permission-denied', '只有商品賣家可以執行這項操作。');
  }
  if ((!allowHeld && listing.status !== 'active')
    || !['active', 'suspended'].includes(listing.status)
    || listing.remainingQuantity < 1) {
    throw new ListingLifecycleError('failed-precondition', '已售罄商品僅供查看。');
  }
  return listing;
}

function saleWire(id: string, sale: StoredSale) {
  return { ...sale, id, soldAt: sale.soldAt.valueOf() };
}

function listingWire(id: string, listing: StoredListing) {
  const wire = {
    id,
    ...listing,
    createdAt: listing.createdAt.valueOf(),
    updatedAt: listing.updatedAt.valueOf(),
  };
  return listing.status === 'suspended'
    ? { ...wire, suspendedAt: listing.suspendedAt!.valueOf() }
    : wire;
}

export async function handleRecordListingSale(
  request: CallableRequest,
  dependencies: ListingLifecycleDependencies,
) {
  const uid = requireAuthUid(request.authUid);
  const input = assertExactObject(request.data, ['listingId', 'quantity', 'soldUnitPrice']);
  const listingId = parseListingId(input.listingId);
  if (!Number.isInteger(input.quantity) || (input.quantity as number) < 1
    || !isPositiveNumber(input.soldUnitPrice)) invalidArgument('成交數量或價格不正確。');
  const quantity = input.quantity as number;
  const soldUnitPrice = input.soldUnitPrice;
  const now = dependencies.now();
  const saleId = dependencies.randomId();
  return dependencies.runTransaction(async (transaction) => {
    await requireActiveAccount(transaction, uid);
    const storedListing = await readOwnedActiveListing(transaction, listingId, uid);
    if (quantity > storedListing.remainingQuantity) {
      throw new ListingLifecycleError('failed-precondition', '成交數量超過剩餘庫存。');
    }
    const remainingQuantity = storedListing.remainingQuantity - quantity;
    const status: ListingStatus = remainingQuantity === 0 ? 'sold_out' : 'active';
    if (!isCardType(storedListing.cardType)
      || !hasTrimmedText(storedListing.cardName, 200)
      || !hasTrimmedText(storedListing.rarity, 100)) {
      throw new ListingLifecycleError(
        'failed-precondition',
        '舊商品缺少完整卡片快照，無法新增成交紀錄。',
      );
    }
    const sale: StoredSale = {
      listingId,
      sellerId: uid,
      cardId: storedListing.cardId,
      cardType: storedListing.cardType,
      cardName: storedListing.cardName,
      rarity: storedListing.rarity,
      quantity,
      listingUnitPrice: storedListing.listingPrice,
      soldUnitPrice,
      soldAt: now,
    };
    transaction.createSale(saleId, sale);
    transaction.updateListing(listingId, { remainingQuantity, status, updatedAt: now });
    return {
      sale: saleWire(saleId, sale),
      listing: { remainingQuantity, status, updatedAt: now.valueOf() },
    };
  });
}

function parseExpectedUpdatedAt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalidArgument();
  return value;
}

function parseUpdateInput(data: unknown): Omit<ListingPatch, 'updatedAt'> & {
  listingId: string;
  expectedUpdatedAt: number;
} {
  const input = assertExactObject(data, [
    'listingId', 'expectedUpdatedAt', 'imageUrls', 'listingPrice', 'hasSleeve',
    'sleeveFee', 'supportsMyShip', 'myShipFee', 'note',
  ]);
  const listingId = parseListingId(input.listingId);
  const expectedUpdatedAt = parseExpectedUpdatedAt(input.expectedUpdatedAt);
  const imageUrls = readImageUrls(input.imageUrls);
  if (!imageUrls || !isPositiveNumber(input.listingPrice)
    || typeof input.hasSleeve !== 'boolean' || typeof input.supportsMyShip !== 'boolean') invalidArgument();
  const sleeveFee = input.sleeveFee === null ? null : readOptionalFee(input.sleeveFee);
  const myShipFee = input.myShipFee === null ? null : readOptionalFee(input.myShipFee);
  if (sleeveFee === undefined || myShipFee === undefined
    || (!input.hasSleeve && sleeveFee !== null)
    || (!input.supportsMyShip && myShipFee !== null)) invalidArgument();
  let note: string | null = null;
  if (input.note !== null) {
    if (typeof input.note !== 'string') invalidArgument();
    const normalized = input.note.trim();
    if (normalized.length > 2000) invalidArgument();
    note = normalized || null;
  }
  return {
    listingId, expectedUpdatedAt, imageUrls, listingPrice: input.listingPrice,
    hasSleeve: input.hasSleeve, sleeveFee, supportsMyShip: input.supportsMyShip,
    myShipFee, note,
  } as Omit<ListingPatch, 'updatedAt'> & { listingId: string; expectedUpdatedAt: number };
}

export async function handleUpdateSellerListing(
  request: CallableRequest,
  dependencies: ListingLifecycleDependencies,
) {
  const uid = requireAuthUid(request.authUid);
  const input = parseUpdateInput(request.data);
  const now = dependencies.now();
  return dependencies.runTransaction(async (transaction) => {
    await requireActiveAccount(transaction, uid);
    const storedListing = await readOwnedActiveListing(transaction, input.listingId, uid, true);
    if (storedListing.updatedAt.valueOf() !== input.expectedUpdatedAt) {
      throw new ListingLifecycleError('aborted', '商品已被更新，請重新載入後再試。');
    }
    const patch: ListingPatch = {
      imageUrls: input.imageUrls,
      listingPrice: input.listingPrice,
      hasSleeve: input.hasSleeve,
      sleeveFee: input.sleeveFee,
      supportsMyShip: input.supportsMyShip,
      myShipFee: input.myShipFee,
      note: input.note,
      updatedAt: now,
    };
    transaction.updateListing(input.listingId, patch);
    const updated: StoredListing = {
      ...storedListing,
      imageUrls: patch.imageUrls,
      listingPrice: patch.listingPrice,
      hasSleeve: patch.hasSleeve,
      supportsMyShip: patch.supportsMyShip,
      updatedAt: now,
    };
    if (patch.sleeveFee === null) delete updated.sleeveFee;
    else updated.sleeveFee = patch.sleeveFee;
    if (patch.myShipFee === null) delete updated.myShipFee;
    else updated.myShipFee = patch.myShipFee;
    if (patch.note === null) delete updated.note;
    else updated.note = patch.note;
    return listingWire(input.listingId, updated);
  });
}

export async function handleDeleteUnsoldListing(
  request: CallableRequest,
  dependencies: ListingLifecycleDependencies,
) {
  const uid = requireAuthUid(request.authUid);
  const input = assertExactObject(request.data, ['listingId', 'expectedUpdatedAt']);
  const listingId = parseListingId(input.listingId);
  const expectedUpdatedAt = parseExpectedUpdatedAt(input.expectedUpdatedAt);
  return dependencies.runTransaction(async (transaction) => {
    await requireActiveAccount(transaction, uid);
    const storedListing = await readOwnedActiveListing(transaction, listingId, uid, true);
    if (storedListing.updatedAt.valueOf() !== expectedUpdatedAt) {
      throw new ListingLifecycleError('aborted', '商品已被更新，請重新載入後再試。');
    }
    if (storedListing.remainingQuantity !== storedListing.originalQuantity
      || await transaction.hasSaleForListing(listingId)) {
      throw new ListingLifecycleError('failed-precondition', '已有成交紀錄的商品不能刪除。');
    }
    transaction.deleteListing(listingId);
    return { imageUrls: [...storedListing.imageUrls] };
  });
}
