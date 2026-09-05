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

const APPEAL_ACTION_PATTERN = /^[0-9a-f]{64}$/u;
const APPEAL_DRAFT_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function accountAppealEvidencePath(
  uid: string, actionId: string, draftId: string, slot: number,
): string {
  if (auth.currentUser?.uid !== uid || uid.length < 1 || uid.length > 128
    || uid !== uid.trim() || uid.includes('/') || !APPEAL_ACTION_PATTERN.test(actionId)
    || !APPEAL_DRAFT_PATTERN.test(draftId) || !Number.isInteger(slot) || slot < 0 || slot > 2) {
    throw new Error('Account appeal evidence path is invalid.');
  }
  return `account-appeal-evidence/${uid}/${actionId}/${draftId}/${slot}`;
}

export async function uploadAccountAppealEvidence(
  uid: string, actionId: string, draftId: string, slot: 0 | 1 | 2, file: File,
): Promise<{ slot: 0 | 1 | 2; generation: string; contentType: 'image/jpeg' | 'image/png' | 'image/webp'; size: number }> {
  const path = accountAppealEvidencePath(uid, actionId, draftId, slot);
  if (!(file instanceof File) || !reportEvidenceTypes.has(file.type)
    || file.size < 1 || file.size > MAX_REPORT_EVIDENCE_BYTES) {
    throw new Error('Account appeal evidence must be a JPEG, PNG, or WebP image up to 5 MiB.');
  }
  try {
    const result = await uploadBytes(ref(storage, path), file, { contentType: file.type });
    const generation = String(result.metadata.generation ?? '');
    const contentType = result.metadata.contentType;
    const size = Number(result.metadata.size);
    if (!/^[1-9][0-9]{0,30}$/u.test(generation)
      || !reportEvidenceTypes.has(contentType ?? '') || size !== file.size) {
      throw new Error('invalid metadata');
    }
    return { slot, generation, contentType: contentType as 'image/jpeg' | 'image/png' | 'image/webp', size };
  } catch {
    throw new Error('無法上傳申訴證據，請稍後再試。');
  }
}

export async function deleteAccountAppealEvidence(
  uid: string, actionId: string, draftId: string, slot: 0 | 1 | 2,
): Promise<void> {
  const path = accountAppealEvidencePath(uid, actionId, draftId, slot);
  try {
    await deleteObject(ref(storage, path));
  } catch {
    throw new Error('無法移除申訴證據，請稍後再試。');
  }
}
