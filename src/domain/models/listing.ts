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
  if (!listing.id) {
    throw new Error('Listing requires id.');
  }

  if (!listing.sellerId) {
    throw new Error('Listing requires sellerId.');
  }

  if (!listing.cardId) {
    throw new Error('Listing requires cardId.');
  }

  if (listing.imageUrls.length < 1 || listing.imageUrls.length > 3) {
    throw new Error('Listing requires 1 to 3 image URLs.');
  }

  if (listing.listingPrice <= 0) {
    throw new Error('Listing price must be greater than 0.');
  }

  if (listing.originalQuantity <= 0) {
    throw new Error('Listing originalQuantity must be greater than 0.');
  }

  if (listing.remainingQuantity < 0 || listing.remainingQuantity > listing.originalQuantity) {
    throw new Error('Listing remainingQuantity must be between 0 and originalQuantity.');
  }

  if (listing.status !== 'active' && listing.status !== 'sold_out') {
    throw new Error('Listing status must be active or sold_out.');
  }
}
