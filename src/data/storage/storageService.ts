import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { auth, storage } from '../../lib/firebase/app';

function assertOwner(sellerId: string) { if (auth.currentUser?.uid !== sellerId) throw new Error('Listing access requires the authenticated seller.'); }
function safeName(name: string) { return (name.normalize('NFKC').replace(/[^\\p{L}\\p{N}_.-]+/gu, '-').replace(/^[-.]+|[-.]+$/g, '') || 'image'); }
export async function uploadListingImages(sellerId: string, listingId: string, files: readonly File[]): Promise<string[]> {
  assertOwner(sellerId);
  if (!sellerId || !listingId || sellerId.includes('/') || listingId.includes('/')) throw new Error('Listing path segments must be safe identifiers.');
  if (files.length < 1 || files.length > 3) throw new Error('Listing images require 1 to 3 image files.');
  if (files.some((file) => !file.type.startsWith('image/'))) throw new Error('Listing images must be image files.');
  return Promise.all(files.map(async (file, index) => {
    const result = await uploadBytes(ref(storage, `listings/${sellerId}/${listingId}/${index}-${safeName(file.name)}`), file);
    return getDownloadURL(result.ref);
  }));
}
