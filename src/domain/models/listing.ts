export type ListingStatus = 'active' | 'sold_out';

export interface Listing {
  id: string;
  sellerId: string;
  cardId: string;
  imageUrls: string[];
  listingPrice: number;
  originalQuantity: number;
  remainingQuantity: number;
  hasSleeve: boolean;
  supportsMyShip: boolean;
  note?: string;
  status: ListingStatus;
  createdAt: Date;
  updatedAt: Date;
}

export function validateListing(listing: Listing) {
  if (typeof listing.id !== 'string' || listing.id.length === 0) {
    throw new Error('Listing requires id.');
  }

  if (typeof listing.sellerId !== 'string' || listing.sellerId.length === 0) {
    throw new Error('Listing requires sellerId.');
  }

  if (typeof listing.cardId !== 'string' || listing.cardId.length === 0) {
    throw new Error('Listing requires cardId.');
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

  if (listing.note !== undefined && typeof listing.note !== 'string') {
    throw new Error('Listing note must be a string when provided.');
  }

  if (listing.status !== 'active' && listing.status !== 'sold_out') {
    throw new Error('Listing status must be active or sold_out.');
  }

  if (!(listing.createdAt instanceof Date) || Number.isNaN(listing.createdAt.valueOf())) {
    throw new Error('Listing requires a valid createdAt date.');
  }

  if (!(listing.updatedAt instanceof Date) || Number.isNaN(listing.updatedAt.valueOf())) {
    throw new Error('Listing requires a valid updatedAt date.');
  }
}
