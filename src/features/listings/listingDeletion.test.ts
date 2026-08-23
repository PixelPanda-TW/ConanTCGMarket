import { describe, expect, it, vi } from 'vitest';
import { deleteListingAndImages } from './listingDeletion';

describe('deleteListingAndImages', () => {
  it('deletes the listing before attempting image cleanup', async () => {
    const events: string[] = [];
    await deleteListingAndImages({ id: 'listing-1', sellerId: 'seller-1', imageUrls: ['image-url'] }, async () => { events.push('listing'); }, async () => { events.push('images'); });
    expect(events).toEqual(['listing', 'images']);
  });

  it('does not delete images when the listing deletion fails', async () => {
    const deleteImages = vi.fn();
    await expect(deleteListingAndImages({ id: 'listing-1', sellerId: 'seller-1', imageUrls: ['image-url'] }, async () => { throw new Error('denied'); }, deleteImages)).rejects.toThrow('denied');
    expect(deleteImages).not.toHaveBeenCalled();
  });
});
