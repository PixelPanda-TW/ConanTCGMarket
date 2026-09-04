import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
  uploadBytesResumable,
} from 'firebase/storage';
import { auth, storage } from '../../lib/firebase/app';

function assertOwner(sellerId: string) { if (auth.currentUser?.uid !== sellerId) throw new Error('Listing access requires the authenticated seller.'); }
function safeName(name: string) { return (name.normalize('NFKC').replace(/[^\\p{L}\\p{N}_.-]+/gu, '-').replace(/^[-.]+|[-.]+$/g, '') || 'image'); }
export async function uploadListingImages(sellerId: string, listingId: string, files: readonly File[]): Promise<string[]> {
  assertOwner(sellerId);
  if (!sellerId || !listingId || sellerId.includes('/') || listingId.includes('/')) throw new Error('Listing path segments must be safe identifiers.');
  if (files.length < 1 || files.length > 3) throw new Error('Listing images require 1 to 3 image files.');
  if (files.some((file) => !file.type.startsWith('image/'))) throw new Error('Listing images must be image files.');
  const uploadBatchId = Date.now().toString(36);
  return Promise.all(files.map(async (file, index) => {
    const result = await uploadBytes(ref(storage, `listings/${sellerId}/${listingId}/${uploadBatchId}-${index}-${safeName(file.name)}`), file);
    return getDownloadURL(result.ref);
  }));
}

export async function deleteListingImages(sellerId: string, imageUrls: readonly string[]): Promise<void> {
  assertOwner(sellerId);
  await Promise.all(imageUrls.map((url) => deleteObject(ref(storage, url))));
}

const reportEvidenceTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_REPORT_EVIDENCE_BYTES = 5 * 1024 * 1024;

function reportEvidencePath(uid: string, reportId: string, slot: number): string {
  if (auth.currentUser?.uid !== uid) {
    throw new Error('Report evidence access requires the authenticated reporter.');
  }
  if (uid.length < 1 || uid.length > 128 || uid !== uid.trim() || uid.includes('/')
    || reportId.length < 1 || reportId.length > 200
    || reportId !== reportId.trim() || reportId.includes('/')
    || !Number.isInteger(slot) || slot < 0 || slot > 2) {
    throw new Error('Report evidence path is invalid.');
  }
  return `reportEvidence/${uid}/${reportId}/${slot}`;
}

export async function uploadReportEvidence(
  uid: string,
  reportId: string,
  slot: number,
  file: File,
  onProgress?: (progress: number) => void,
): Promise<string> {
  const path = reportEvidencePath(uid, reportId, slot);
  if (!(file instanceof File)
    || !reportEvidenceTypes.has(file.type)
    || file.size < 1
    || file.size > MAX_REPORT_EVIDENCE_BYTES) {
    throw new Error('Report evidence must be a JPEG, PNG, or WebP image up to 5 MiB.');
  }
  const object = ref(storage, path);
  const task = uploadBytesResumable(object, file, { contentType: file.type });
  await new Promise<void>((resolve, reject) => {
    task.on(
      'state_changed',
      (snapshot) => {
        if (onProgress) {
          const progress = snapshot.totalBytes > 0
            ? snapshot.bytesTransferred / snapshot.totalBytes
            : 0;
          onProgress(Math.max(0, Math.min(1, progress)));
        }
      },
      () => reject(new Error('無法上傳檢舉證據，請稍後再試。')),
      resolve,
    );
  });
  return path;
}

export async function deleteReportEvidence(
  uid: string,
  reportId: string,
  slot: number,
): Promise<void> {
  const path = reportEvidencePath(uid, reportId, slot);
  await deleteObject(ref(storage, path));
}
