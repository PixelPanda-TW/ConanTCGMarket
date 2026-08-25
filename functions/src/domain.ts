export type ListingStatus = 'active' | 'sold_out';
export type DiscordStatus = 'pending' | 'sent' | 'failed';

export interface ListingSnapshot {
  cardId: string;
  characterName?: string;
  rarity?: string;
  listingPrice: number;
  remainingQuantity: number;
  status: ListingStatus;
  createdAt: Date;
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
  createdAt: Date;
  discordStatus: DiscordStatus;
  discordSentAt?: Date;
  attempts: number;
  nextAttemptAt?: Date;
}

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

export function toListingEvent(listingId: string, listing: ListingSnapshot): ListingEvent {
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
    createdAt: listing.createdAt,
    discordStatus: 'pending',
    attempts: 0,
  };
}
