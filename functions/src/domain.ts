import { Timestamp } from 'firebase-admin/firestore';

export type ListingStatus = 'active' | 'sold_out';
export type DiscordStatus = 'pending' | 'sent' | 'failed';

export interface ListingSnapshot {
  cardId: string;
  characterName?: string;
  rarity?: string;
  listingPrice: number;
  remainingQuantity: number;
  status: ListingStatus;
  createdAt: Date | Timestamp;
}

export interface ListingEvent {
  id: string;
  listingId: string;
  characterKey: string;
  characterName: string;
  rarity: string;
  cardId: string;
  listingPrice: number;
  remainingQuantity: number;
  createdAt: Timestamp;
  capturedAt: Timestamp;
  discordStatus: DiscordStatus;
  discordSentAt?: Timestamp;
  discordClaimId?: string;
  discordLeaseUntil?: Timestamp;
  attempts: number;
  nextAttemptAt?: Timestamp;
}

export type ListingEventDraft = Omit<ListingEvent, 'capturedAt'>;

export interface DigestGroup {
  characterName: string;
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

function normalizeMetadata(value: string | undefined): string {
  return value?.normalize('NFKC').trim().replace(/\s+/g, ' ') ?? '';
}

export function toListingEvent(
  listingId: string,
  listing: ListingSnapshot,
): ListingEventDraft {
  if (listing.status !== 'active') {
    throw new Error('Listing event requires an active listing.');
  }

  const characterName = normalizeMetadata(listing.characterName);
  const rarity = normalizeMetadata(listing.rarity);

  if (!characterName || !rarity) {
    throw new Error('Listing event requires character metadata.');
  }

  return {
    id: listingId,
    listingId,
    characterKey: characterName,
    characterName,
    rarity,
    cardId: listing.cardId,
    listingPrice: listing.listingPrice,
    remainingQuantity: listing.remainingQuantity,
    createdAt: listing.createdAt instanceof Timestamp
      ? listing.createdAt
      : Timestamp.fromDate(listing.createdAt),
    discordStatus: 'pending',
    attempts: 0,
  };
}
