import { isCardType, type CardType } from '../cardType';
import { isCompleteCardId } from '../cardId';

export type ListingStatus = 'active' | 'sold_out' | 'suspended';

export interface Listing {
  id: string;
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

export function validateListing(listing: Listing, allowLegacyCardMetadata = false) {
  if (typeof listing.id !== 'string' || listing.id.length === 0) {
    throw new Error('Listing requires id.');
  }

  if (typeof listing.sellerId !== 'string' || listing.sellerId.length === 0) {
    throw new Error('Listing requires sellerId.');
  }

  if ((typeof listing.cardId !== 'string' || !isCompleteCardId(listing.cardId)) && !allowLegacyCardMetadata) {
    throw new Error('Listing requires a complete cardId.');
  }

  const hasCharacterName = typeof listing.characterName === 'string' && listing.characterName.trim().length > 0;
  const hasCardName = typeof listing.cardName === 'string' && listing.cardName.trim().length > 0;
  const hasRarity = typeof listing.rarity === 'string' && listing.rarity.trim().length > 0;
  const hasNormalizedMetadata = listing.cardType !== undefined || listing.cardName !== undefined;
  if (isCardType(listing.cardType) && listing.cardType !== 'character' && listing.characterName !== undefined) {
    throw new Error('Non-character Listing cannot contain characterName.');
  }

  if (!isCardType(listing.cardType) || !hasCardName || !hasRarity) {
    if (!allowLegacyCardMetadata || hasNormalizedMetadata) {
      throw new Error('Listing requires cardType, cardName, and rarity snapshots.');
    }
  } else if (listing.cardType === 'character') {
    if (!hasCharacterName || listing.characterName !== listing.cardName) {
      throw new Error('Character Listing requires characterName to equal cardName.');
    }
  }

  if (
    !Array.isArray(listing.imageUrls) ||
    listing.imageUrls.length < 1 ||
    listing.imageUrls.length > 3 ||
    listing.imageUrls.some((imageUrl) => typeof imageUrl !== 'string')
  ) {
    throw new Error('Listing requires 1 to 3 image URLs.');
  }

  if (!Number.isFinite(listing.listingPrice) || listing.listingPrice <= 0) {
    throw new Error('Listing price must be greater than 0.');
  }

  if (!Number.isInteger(listing.originalQuantity) || listing.originalQuantity <= 0) {
    throw new Error('Listing originalQuantity must be greater than 0.');
  }

  if (
    !Number.isInteger(listing.remainingQuantity) ||
    listing.remainingQuantity < 0 ||
    listing.remainingQuantity > listing.originalQuantity
  ) {
    throw new Error('Listing remainingQuantity must be between 0 and originalQuantity.');
  }

  if (typeof listing.hasSleeve !== 'boolean' || typeof listing.supportsMyShip !== 'boolean') {
    throw new Error('Listing sleeve and shipping flags must be booleans.');
  }

  if (listing.sleeveFee !== undefined && (!Number.isFinite(listing.sleeveFee) || listing.sleeveFee < 0)) {
    throw new Error('Listing sleeveFee must be non-negative when provided.');
  }

  if (listing.myShipFee !== undefined && (!Number.isFinite(listing.myShipFee) || listing.myShipFee < 0)) {
    throw new Error('Listing myShipFee must be non-negative when provided.');
  }

  if (listing.note !== undefined && typeof listing.note !== 'string') {
    throw new Error('Listing note must be a string when provided.');
  }

  if (!['active', 'sold_out', 'suspended'].includes(listing.status)) {
    throw new Error('Listing status must be active, sold_out, or suspended.');
  }

  if (listing.status === 'suspended') {
    if (listing.remainingQuantity < 1
      || typeof listing.suspensionActionId !== 'string'
      || listing.suspensionActionId.length < 1
      || listing.suspensionActionId.length > 200
      || listing.suspensionActionId !== listing.suspensionActionId.trim()
      || !(listing.suspendedAt instanceof Date)
      || Number.isNaN(listing.suspendedAt.valueOf())) {
      throw new Error('Suspended Listing requires canonical hold fields and remaining inventory.');
    }
  } else if (listing.suspensionActionId !== undefined || listing.suspendedAt !== undefined) {
    throw new Error('Active and sold_out Listings must omit suspension hold fields.');
  }

  if (!(listing.createdAt instanceof Date) || Number.isNaN(listing.createdAt.valueOf())) {
    throw new Error('Listing requires a valid createdAt date.');
  }

  if (!(listing.updatedAt instanceof Date) || Number.isNaN(listing.updatedAt.valueOf())) {
    throw new Error('Listing requires a valid updatedAt date.');
  }
  if (listing.status === 'suspended' && listing.suspendedAt!.valueOf() > listing.updatedAt.valueOf()) {
    throw new Error('Listing suspension time cannot follow updatedAt.');
  }
}
