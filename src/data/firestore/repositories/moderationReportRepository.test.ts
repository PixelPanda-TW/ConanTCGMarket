import { beforeEach, describe, expect, it, vi } from 'vitest';

const functions = vi.hoisted(() => ({
  callableByName: new Map<string, ReturnType<typeof vi.fn>>(),
  httpsCallable: vi.fn((_client: unknown, name: string) => (
    functions.callableByName.get(name) ?? vi.fn()
  )),
}));
const firebaseApp = vi.hoisted(() => ({
  auth: { currentUser: { uid: 'buyer-1' } },
  functionsClient: { type: 'functions' },
}));

vi.mock('firebase/functions', () => functions);
vi.mock('../../../lib/firebase/app', () => firebaseApp);

import {
  createModerationReportDraft,
  submitModerationReport,
} from './moderationReportRepository';

const createInput = {
  uid: 'buyer-1', requestId: '550e8400-e29b-41d4-a716-446655440000', listingId: 'listing-1',
};
const submitInput = {
  uid: 'buyer-1', reportId: 'report-1', category: 'other' as const,
  description: '可疑的交易要求', evidencePaths: ['reportEvidence/buyer-1/report-1/0'],
};

describe('moderation report repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    functions.callableByName.clear();
    functions.callableByName.set('createModerationReportDraft', vi.fn());
    functions.callableByName.set('submitModerationReport', vi.fn());
    firebaseApp.auth.currentUser = { uid: 'buyer-1' };
  });

  it('calls draft creation with a stable caller-owned request ID and parses ISO expiry', async () => {
    const callable = functions.callableByName.get('createModerationReportDraft')!;
    callable.mockResolvedValue({
      data: { reportId: 'report-1', expiresAt: '2026-09-05T00:00:00.000Z' },
    });
    await expect(createModerationReportDraft(createInput)).resolves.toEqual({
      reportId: 'report-1', expiresAt: new Date('2026-09-05T00:00:00.000Z'),
    });
    await createModerationReportDraft(createInput);
    expect(callable).toHaveBeenNthCalledWith(1, {
      requestId: createInput.requestId, listingId: 'listing-1',
    });
    expect(callable).toHaveBeenNthCalledWith(2, {
      requestId: createInput.requestId, listingId: 'listing-1',
    });
  });

  it('calls submission with exact server fields and adopts only the opaque reference', async () => {
    const callable = functions.callableByName.get('submitModerationReport')!;
    callable.mockResolvedValue({ data: { reportId: 'report-1' } });
    await expect(submitModerationReport(submitInput)).resolves.toEqual({ reportId: 'report-1' });
    expect(callable).toHaveBeenCalledWith({
      reportId: 'report-1', category: 'other', description: '可疑的交易要求',
      evidencePaths: ['reportEvidence/buyer-1/report-1/0'],
    });
  });

  it.each([
    ['extra draft response field', { reportId: 'report-1', expiresAt: '2026-09-05T00:00:00.000Z', email: 'x@y.z' }],
    ['invalid expiry', { reportId: 'report-1', expiresAt: 'not-a-date' }],
    ['numeric expiry', { reportId: 'report-1', expiresAt: 123 }],
  ])('rejects malformed draft responses: %s', async (_label, data) => {
    functions.callableByName.get('createModerationReportDraft')!.mockResolvedValue({ data });
    await expect(createModerationReportDraft(createInput)).rejects.toThrow('invalid report draft response');
  });

  it.each([
    { reportId: 'report-1', email: 'private@example.test' },
    { reportId: '' },
    {},
  ])('rejects malformed submit response %#', async (data) => {
    functions.callableByName.get('submitModerationReport')!.mockResolvedValue({ data });
    await expect(submitModerationReport(submitInput)).rejects.toThrow('invalid report submission response');
  });

  it('rejects cross-account calls before creating a callable', async () => {
    await expect(createModerationReportDraft({ ...createInput, uid: 'other-user' }))
      .rejects.toThrow('authenticated reporter');
    await expect(submitModerationReport({ ...submitInput, uid: 'other-user' }))
      .rejects.toThrow('authenticated reporter');
    expect(functions.httpsCallable).not.toHaveBeenCalled();
  });

  it.each([
    ['bad UUID', { ...createInput, requestId: 'retry-1' }],
    ['blank Listing', { ...createInput, listingId: ' ' }],
    ['padded description', { ...submitInput, description: ' 說明' }],
    ['wrong evidence owner', { ...submitInput, evidencePaths: ['reportEvidence/other/report-1/0'] }],
  ])('rejects malformed local input before the SDK call: %s', async (_label, input) => {
    const operation = 'requestId' in input
      ? createModerationReportDraft(input)
      : submitModerationReport(input as typeof submitInput);
    await expect(operation).rejects.toThrow();
    expect(functions.httpsCallable).not.toHaveBeenCalled();
  });

  it('maps callable failures to a generic service error', async () => {
    functions.callableByName.get('createModerationReportDraft')!
      .mockRejectedValue(new Error('internal/path private payload'));
    await expect(createModerationReportDraft(createInput)).rejects.toThrow(
      '檢舉服務目前無法使用，請稍後再試。',
    );
  });
});
