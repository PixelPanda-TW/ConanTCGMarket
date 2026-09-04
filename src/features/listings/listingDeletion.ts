export interface DeletableListing {
  id: string;
  sellerId: string;
  imageUrls: readonly string[];
}

export async function deleteListingAndImages(
  listing: DeletableListing,
  deleteRecord: (listing: DeletableListing) => Promise<readonly string[] | void>,
  deleteImages: (sellerId: string, imageUrls: readonly string[]) => Promise<void>,
): Promise<void> {
  const storedImageUrls = await deleteRecord(listing);
  await deleteImages(
    listing.sellerId,
    Array.isArray(storedImageUrls) ? storedImageUrls : listing.imageUrls,
  );
}
