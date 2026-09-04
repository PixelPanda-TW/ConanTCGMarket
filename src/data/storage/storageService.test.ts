import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageSdk = vi.hoisted(() => ({
  deleteObject: vi.fn(),
  getDownloadURL: vi.fn(),
  ref: vi.fn((_storage: unknown, path: string) => ({ path })),
  uploadBytes: vi.fn(),
  uploadBytesResumable: vi.fn(),
}));
const firebaseApp = vi.hoisted(() => ({
  auth: { currentUser: { uid: 'buyer-1' } }, storage: { type: 'storage' },
}));

vi.mock('firebase/storage', () => storageSdk);
vi.mock('../../lib/firebase/app', () => firebaseApp);

import { deleteReportEvidence, uploadReportEvidence } from './storageService';

function image(type = 'image/png', size = 100): File {
  return new File([new Uint8Array(size)], 'evidence.png', { type });
}

function successfulTask() {
  return {
    on: vi.fn((_event, progress, _error, complete) => {
      progress({ bytesTransferred: 25, totalBytes: 100 });
      progress({ bytesTransferred: 100, totalBytes: 100 });
      complete();
    }),
  };
}

describe('report evidence Storage operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firebaseApp.auth.currentUser = { uid: 'buyer-1' };
    storageSdk.uploadBytesResumable.mockReturnValue(successfulTask());
    storageSdk.deleteObject.mockResolvedValue(undefined);
  });

  it.each([0, 1, 2])('uploads slot %i to the exact private canonical path', async (slot) => {
    await expect(uploadReportEvidence(
      'buyer-1', 'report-1', slot, image(),
    )).resolves.toBe(`reportEvidence/buyer-1/report-1/${slot}`);
    expect(storageSdk.ref).toHaveBeenCalledWith(
      firebaseApp.storage, `reportEvidence/buyer-1/report-1/${slot}`,
    );
    expect(storageSdk.uploadBytesResumable).toHaveBeenCalledWith(
      { path: `reportEvidence/buyer-1/report-1/${slot}` }, expect.any(File),
      { contentType: 'image/png' },
    );
  });

  it('reports bounded upload progress and resolves only after completion', async () => {
    const progress = vi.fn();
    await uploadReportEvidence('buyer-1', 'report-1', 0, image(), progress);
    expect(progress.mock.calls).toEqual([[0.25], [1]]);
  });

  it('supports replacement by uploading the same slot path again', async () => {
    await uploadReportEvidence('buyer-1', 'report-1', 1, image());
    await uploadReportEvidence('buyer-1', 'report-1', 1, image('image/webp'));
    expect(storageSdk.ref).toHaveBeenNthCalledWith(
      1, firebaseApp.storage, 'reportEvidence/buyer-1/report-1/1',
    );
    expect(storageSdk.ref).toHaveBeenNthCalledWith(
      2, firebaseApp.storage, 'reportEvidence/buyer-1/report-1/1',
    );
  });

  it('deletes only one exact slot path', async () => {
    await deleteReportEvidence('buyer-1', 'report-1', 2);
    expect(storageSdk.deleteObject).toHaveBeenCalledWith({
      path: 'reportEvidence/buyer-1/report-1/2',
    });
  });

  it('rejects an upload task failure with a generic error', async () => {
    storageSdk.uploadBytesResumable.mockReturnValue({
      on: vi.fn((_event, _progress, error) => error(new Error('private bucket detail'))),
    });
    await expect(uploadReportEvidence('buyer-1', 'report-1', 0, image()))
      .rejects.toThrow('無法上傳檢舉證據，請稍後再試。');
  });

  it.each([
    ['wrong user', 'other-user', 'report-1', 0, image()],
    ['unsafe UID', 'buyer/1', 'report-1', 0, image()],
    ['unsafe report ID', 'buyer-1', '../report', 0, image()],
    ['negative slot', 'buyer-1', 'report-1', -1, image()],
    ['slot three', 'buyer-1', 'report-1', 3, image()],
    ['fractional slot', 'buyer-1', 'report-1', 1.5, image()],
    ['PDF', 'buyer-1', 'report-1', 0, image('application/pdf')],
    ['empty file', 'buyer-1', 'report-1', 0, image('image/png', 0)],
    ['oversized', 'buyer-1', 'report-1', 0, image('image/png', 5 * 1024 * 1024 + 1)],
  ])('refuses malformed upload before any SDK call: %s', async (
    _label, uid, reportId, slot, file,
  ) => {
    await expect(uploadReportEvidence(uid, reportId, slot, file)).rejects.toThrow();
    expect(storageSdk.ref).not.toHaveBeenCalled();
    expect(storageSdk.uploadBytesResumable).not.toHaveBeenCalled();
  });

  it('refuses malformed delete before any SDK call', async () => {
    await expect(deleteReportEvidence('buyer-1', 'bad/report', 0)).rejects.toThrow();
    expect(storageSdk.ref).not.toHaveBeenCalled();
    expect(storageSdk.deleteObject).not.toHaveBeenCalled();
  });
});
