import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createModerationEvidenceUrl } from './moderationEvidence';

describe('moderation evidence Blob lifecycle', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a private local Blob URL with the verified MIME and bytes', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:evidence-1');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    const handle = createModerationEvidenceUrl({
      contentType: 'image/png', size: 3, dataBase64: 'AQID',
    });

    expect(handle.url).toBe('blob:evidence-1');
    expect(createObjectURL).toHaveBeenCalledOnce();
    const object = createObjectURL.mock.calls[0][0];
    expect(object).toBeInstanceOf(Blob);
    const blob = object as Blob;
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(3);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('revokes its local URL exactly once even when cleanup repeats', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:evidence-1');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const handle = createModerationEvidenceUrl({
      contentType: 'image/webp', size: 3, dataBase64: 'AQID',
    });

    handle.revoke();
    handle.revoke();
    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:evidence-1');
  });
});
