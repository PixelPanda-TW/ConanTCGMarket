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

function readCreatedAt(value: unknown): Timestamp {
  if (value instanceof Timestamp) {
    return value;
  }
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    return invalidSnapshot('createdAt must be a valid Firestore Timestamp or Date.');
  }
  return Timestamp.fromDate(value);
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

  const cardName = readMetadata(data.cardName, 'cardName', MAX_CARD_NAME_LENGTH);
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
