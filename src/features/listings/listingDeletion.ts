export interface DeletableListing {
  id: string;
  sellerId: string;
  imageUrls: readonly string[];
}

export class ListingImageCleanupError extends Error {
  readonly listingDeleted = true;

  constructor(cause: unknown) {
    super('商品已刪除，但圖片清理失敗，請聯絡管理員協助。', { cause });
    this.name = 'ListingImageCleanupError';
  }
}

export async function deleteListingAndImages(
  listing: DeletableListing,
  deleteRecord: (listing: DeletableListing) => Promise<readonly string[] | void>,
  deleteImages: (sellerId: string, imageUrls: readonly string[]) => Promise<void>,
): Promise<void> {
  const storedImageUrls = await deleteRecord(listing);
  try {
    await deleteImages(
      listing.sellerId,
      Array.isArray(storedImageUrls) ? storedImageUrls : listing.imageUrls,
    );
  } catch (error) {
    throw new ListingImageCleanupError(error);
  }
}
