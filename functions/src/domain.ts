import { Timestamp } from 'firebase-admin/firestore';

export type ListingStatus = 'active' | 'sold_out';
export type DiscordStatus = 'disabled' | 'pending' | 'sent' | 'failed';

export interface ListingEventOptions {
  discordEnabled?: boolean;
}

export interface ListingSnapshot {
  cardId: string;
  cardType: 'character' | 'event' | 'case' | 'partner';
  cardName: string;
  rarity?: string;
  listingPrice: number;
  remainingQuantity: number;
  status: ListingStatus;
  createdAt: Date | Timestamp;
}

export interface ListingEvent {
  id: string;
  listingId: string;
  cardType: 'character' | 'event' | 'case' | 'partner';
  cardName: string;
  cardId: string;
  rarity: string;
  listingPrice: number;
  remainingQuantity: number;
  createdAt: Timestamp;
  capturedAt: Timestamp;
  capturedSequence: number;
  discordStatus: DiscordStatus;
  discordSentAt?: Timestamp;
  discordClaimId?: string;
  discordLeaseUntil?: Timestamp;
  attempts: number;
  nextAttemptAt?: Timestamp;
}

export interface ListingEventPage {
  events: ListingEvent[];
  nextAfterSequence: number;
  hasMore: boolean;
}

export type ListingEventDraft = Omit<ListingEvent, 'capturedAt' | 'capturedSequence'>;

export interface DigestGroup {
  cardName: string;
  listings: ListingEvent[];
}

export interface DigestEmail {
  to: string;
  subject: string;
  groups: DigestGroup[];
  text: string;
  html: string;
}

export interface DiscordClient {
  publishNewListing(event: ListingEvent): Promise<void>;
}

export interface GmailClient {
  sendDigest(message: DigestEmail): Promise<void>;
}

export interface RecipientDirectory {
  getVerifiedEmail(uid: string): Promise<string | null>;
}

const MAX_LISTING_ID_LENGTH = 200;
const MAX_CARD_ID_LENGTH = 100;
const MAX_CARD_NAME_LENGTH = 100;
const MAX_RARITY_LENGTH = 50;
const MAX_LISTING_PRICE = 10_000_000;
const MAX_REMAINING_QUANTITY = 10_000;

export class InvalidListingSnapshotError extends Error {
  constructor(reason: string) {
    super(`Invalid Listing snapshot: ${reason}`);
    this.name = 'InvalidListingSnapshotError';
  }
}

function invalidSnapshot(reason: string): never {
  throw new InvalidListingSnapshotError(reason);
}

function readMetadata(
  value: unknown,
  fieldName: string,
  maximumLength: number,
): string {
  if (typeof value !== 'string') {
    return invalidSnapshot(`${fieldName} must be a string.`);
  }

  const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > maximumLength) {
    return invalidSnapshot(
      `${fieldName} must contain 1 to ${maximumLength} characters.`,
    );
  }
  return normalized;
}

function readRawCardName(value: unknown): string {
  if (typeof value !== 'string') {
    return invalidSnapshot('cardName must be a string.');
  }
  if (value.trim().length === 0 || value.length > MAX_CARD_NAME_LENGTH) {
    return invalidSnapshot(
      `cardName must contain 1 to ${MAX_CARD_NAME_LENGTH} characters.`,
    );
  }
  return value;
}

function readCreatedAt(value: unknown): Timestamp {
  if (value instanceof Timestamp) {
    return value;
  }
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    return invalidSnapshot('createdAt must be a valid Firestore Timestamp or Date.');
  }
  return Timestamp.fromDate(value);
}

const LISTING_EVENT_FIELDS = new Set([
  'id',
  'listingId',
  'cardType',
  'cardName',
  'cardId',
  'rarity',
  'listingPrice',
  'remainingQuantity',
  'createdAt',
  'capturedAt',
  'capturedSequence',
  'discordStatus',
  'discordSentAt',
  'discordClaimId',
  'discordLeaseUntil',
  'attempts',
  'nextAttemptAt',
]);

function isStoredString(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= maximumLength;
}

export function readListingEvent(value: unknown): ListingEvent | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const data = value as Record<string, unknown>;
  if (Object.keys(data).some((field) => !LISTING_EVENT_FIELDS.has(field))
    || !isStoredString(data.id, MAX_LISTING_ID_LENGTH)
    || !isStoredString(data.listingId, MAX_LISTING_ID_LENGTH)
    || data.id !== data.listingId
    || (data.cardType !== 'character'
      && data.cardType !== 'event'
      && data.cardType !== 'case'
      && data.cardType !== 'partner')
    || !isStoredString(data.cardName, MAX_CARD_NAME_LENGTH)
    || !isStoredString(data.cardId, MAX_CARD_ID_LENGTH)
    || !isStoredString(data.rarity, MAX_RARITY_LENGTH)
    || typeof data.listingPrice !== 'number'
    || !Number.isFinite(data.listingPrice)
    || data.listingPrice <= 0
    || data.listingPrice > MAX_LISTING_PRICE
    || typeof data.remainingQuantity !== 'number'
    || !Number.isInteger(data.remainingQuantity)
    || data.remainingQuantity <= 0
    || data.remainingQuantity > MAX_REMAINING_QUANTITY
    || !(data.createdAt instanceof Timestamp)
    || !(data.capturedAt instanceof Timestamp)
    || typeof data.capturedSequence !== 'number'
    || !Number.isSafeInteger(data.capturedSequence)
    || data.capturedSequence <= 0
    || (data.discordStatus !== 'disabled'
      && data.discordStatus !== 'pending'
      && data.discordStatus !== 'sent'
      && data.discordStatus !== 'failed')
    || typeof data.attempts !== 'number'
    || !Number.isSafeInteger(data.attempts)
    || data.attempts < 0
    || (data.discordSentAt !== undefined && !(data.discordSentAt instanceof Timestamp))
    || (data.discordClaimId !== undefined
      && !isStoredString(data.discordClaimId, MAX_LISTING_ID_LENGTH))
    || (data.discordLeaseUntil !== undefined
      && !(data.discordLeaseUntil instanceof Timestamp))
    || (data.nextAttemptAt !== undefined && !(data.nextAttemptAt instanceof Timestamp))) {
    return null;
  }

  return {
    id: data.id,
    listingId: data.listingId,
    cardType: data.cardType,
    cardName: data.cardName,
    cardId: data.cardId,
    rarity: data.rarity,
    listingPrice: data.listingPrice,
    remainingQuantity: data.remainingQuantity,
    createdAt: data.createdAt,
    capturedAt: data.capturedAt,
    capturedSequence: data.capturedSequence,
    discordStatus: data.discordStatus,
    ...(data.discordSentAt === undefined ? {} : { discordSentAt: data.discordSentAt }),
    ...(data.discordClaimId === undefined ? {} : { discordClaimId: data.discordClaimId }),
    ...(data.discordLeaseUntil === undefined
      ? {}
      : { discordLeaseUntil: data.discordLeaseUntil }),
    attempts: data.attempts,
    ...(data.nextAttemptAt === undefined ? {} : { nextAttemptAt: data.nextAttemptAt }),
  };
}

export function readListingEventPage(
  values: readonly unknown[],
  afterSequence: number,
  limit: number,
): ListingEventPage {
  if (!Number.isSafeInteger(afterSequence) || afterSequence < 0
    || !Number.isSafeInteger(limit) || limit <= 0
    || values.length > limit) {
    throw new Error('Daily digest event page arguments are invalid.');
  }

  if (values.length === 0) {
    return { events: [], nextAfterSequence: afterSequence, hasMore: false };
  }

  const lastValue = values[values.length - 1];
  const nextAfterSequence = typeof lastValue === 'object'
    && lastValue !== null
    && !Array.isArray(lastValue)
    ? (lastValue as Record<string, unknown>).capturedSequence
    : undefined;
  if (typeof nextAfterSequence !== 'number'
    || !Number.isSafeInteger(nextAfterSequence)
    || nextAfterSequence <= afterSequence) {
    throw new Error('Daily digest raw event pagination did not advance.');
  }

  const events = values.flatMap((item) => {
    const event = readListingEvent(item);
    return event && event.capturedSequence > afterSequence ? [event] : [];
  });
  return {
    events,
    nextAfterSequence,
    hasMore: values.length === limit,
  };
}

export function toListingEvent(
  listingId: string,
  listing: unknown,
  options: ListingEventOptions = {},
): ListingEventDraft {
  if (typeof listingId !== 'string'
    || listingId.length === 0
    || listingId.length > MAX_LISTING_ID_LENGTH) {
    return invalidSnapshot(`listingId must contain 1 to ${MAX_LISTING_ID_LENGTH} characters.`);
  }
  if (typeof listing !== 'object' || listing === null || Array.isArray(listing)) {
    return invalidSnapshot('document data must be an object.');
  }

  const data = listing as Record<string, unknown>;
  if (data.status !== 'active') {
    return invalidSnapshot('Listing event requires an active listing. status must be active.');
  }

  if (data.cardType !== 'character'
    && data.cardType !== 'event'
    && data.cardType !== 'case'
    && data.cardType !== 'partner') {
    return invalidSnapshot('cardType must be character, event, case, or partner.');
  }

  const cardName = readRawCardName(data.cardName);
  const rarity = readMetadata(data.rarity, 'rarity', MAX_RARITY_LENGTH);
  const cardId = readMetadata(data.cardId, 'cardId', MAX_CARD_ID_LENGTH);

  if (typeof data.listingPrice !== 'number'
    || !Number.isFinite(data.listingPrice)
    || data.listingPrice <= 0
    || data.listingPrice > MAX_LISTING_PRICE) {
    return invalidSnapshot(`listingPrice must be a finite number between 0 and ${MAX_LISTING_PRICE}.`);
  }
  if (typeof data.remainingQuantity !== 'number'
    || !Number.isInteger(data.remainingQuantity)
    || data.remainingQuantity <= 0
    || data.remainingQuantity > MAX_REMAINING_QUANTITY) {
    return invalidSnapshot(
      `remainingQuantity must be an integer between 1 and ${MAX_REMAINING_QUANTITY}.`,
    );
  }

  return {
    id: listingId,
    listingId,
    cardType: data.cardType,
    cardName,
    cardId,
    rarity,
    listingPrice: data.listingPrice,
    remainingQuantity: data.remainingQuantity,
    createdAt: readCreatedAt(data.createdAt),
    discordStatus: options.discordEnabled === false ? 'disabled' : 'pending',
    attempts: 0,
  };
}
