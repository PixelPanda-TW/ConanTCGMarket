export interface DeletableListing {
  id: string;
  sellerId: string;
  imageUrls: readonly string[];
}

export async function deleteListingAndImages(
  listing: DeletableListing,
  deleteRecord: (listing: DeletableListing) => Promise<void>,
  deleteImages: (sellerId: string, imageUrls: readonly string[]) => Promise<void>,
): Promise<void> {
  await deleteRecord(listing);
  await deleteImages(listing.sellerId, listing.imageUrls);
}
