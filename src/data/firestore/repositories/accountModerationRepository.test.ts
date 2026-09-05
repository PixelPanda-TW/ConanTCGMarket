import { beforeEach, describe, expect, it, vi } from 'vitest';

const functions = vi.hoisted(() => ({
  callableByName: new Map<string, ReturnType<typeof vi.fn>>(),
  httpsCallable: vi.fn((_client: unknown, name: string) => (
    functions.callableByName.get(name) ?? vi.fn()
  )),
}));
vi.mock('firebase/functions', () => functions);
vi.mock('../../../lib/firebase/app', () => ({ functionsClient: { type: 'functions' } }));

import {
  createAccountModerationRequestId,
  republishSuspendedListing,
  restoreModerationTarget,
  suspendModerationTarget,
} from './accountModerationRepository';

const requestId = '550e8400-e29b-41d4-a716-446655440000';
const actionId = 'a'.repeat(64);

describe('account moderation repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    functions.callableByName.clear();
    for (const name of [
      'suspendModerationTarget', 'restoreModerationTarget', 'republishSuspendedListing',
    ]) functions.callableByName.set(name, vi.fn());
  });

  it('creates a caller-owned v4 UUID once and sends stable exact suspension retries', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(requestId);
    expect(createAccountModerationRequestId()).toBe(requestId);
    const callable = functions.callableByName.get('suspendModerationTarget')!;
    callable.mockResolvedValue({ data: {
      actionId, status: 'hiding', targetUid: 'seller-1', hiddenListingCount: 100,
    } });
    const input = { reportId: 'report-1', requestId, reason: '重複違規' };
    await suspendModerationTarget(input);
    await suspendModerationTarget(input);
    expect(callable).toHaveBeenNthCalledWith(1, input);
    expect(callable).toHaveBeenNthCalledWith(2, input);
  });

  it('calls restoration and republish with exact payloads and parses trusted results', async () => {
    functions.callableByName.get('restoreModerationTarget')!.mockResolvedValue({ data: {
      actionId, status: 'restored', targetUid: 'seller-1', hiddenListingCount: 3,
    } });
    await expect(restoreModerationTarget({
      reportId: 'report-1', suspensionActionId: actionId, requestId, reason: '申訴成立',
    })).resolves.toMatchObject({ actionId, status: 'restored' });
    expect(functions.callableByName.get('restoreModerationTarget')).toHaveBeenCalledWith({
      reportId: 'report-1', suspensionActionId: actionId, requestId, reason: '申訴成立',
    });

    functions.callableByName.get('republishSuspendedListing')!.mockResolvedValue({ data: {
      listingId: 'listing-1', status: 'active', updatedAt: 1_788_278_400_000,
    } });
    await expect(republishSuspendedListing({
      listingId: 'listing-1', suspensionActionId: actionId,
    })).resolves.toEqual({
      listingId: 'listing-1', status: 'active', updatedAt: new Date(1_788_278_400_000),
    });
  });

  it.each([
    ['extra operation field', 'suspendModerationTarget', {
      actionId, status: 'hiding', targetUid: 'seller-1', hiddenListingCount: 0, email: 'private',
    }],
    ['invalid action', 'suspendModerationTarget', {
      actionId: 'action-1', status: 'hiding', targetUid: 'seller-1', hiddenListingCount: 0,
    }],
    ['wrong restoration status', 'restoreModerationTarget', {
      actionId, status: 'suspended', targetUid: 'seller-1', hiddenListingCount: 0,
    }],
    ['private republish field', 'republishSuspendedListing', {
      listingId: 'listing-1', status: 'active', updatedAt: 1, sellerId: 'private',
    }],
    ['unsafe republish date', 'republishSuspendedListing', {
      listingId: 'listing-1', status: 'active', updatedAt: Number.MAX_SAFE_INTEGER + 1,
    }],
  ])('rejects malformed responses: %s', async (_label, callableName, data) => {
    functions.callableByName.get(callableName)!.mockResolvedValue({ data });
    const operation = callableName === 'suspendModerationTarget'
      ? suspendModerationTarget({ reportId: 'report-1', requestId, reason: '重複違規' })
      : callableName === 'restoreModerationTarget'
        ? restoreModerationTarget({
          reportId: 'report-1', suspensionActionId: actionId, requestId, reason: '申訴成立',
        })
        : republishSuspendedListing({ listingId: 'listing-1', suspensionActionId: actionId });
    await expect(operation).rejects.toThrow('invalid account moderation response');
  });

  it.each([
    ['bad UUID', () => suspendModerationTarget({
      reportId: 'report-1', requestId: 'retry-1', reason: '重複違規',
    })],
    ['padded reason', () => restoreModerationTarget({
      reportId: 'report-1', suspensionActionId: actionId, requestId, reason: ' 申訴成立',
    })],
    ['bad action', () => republishSuspendedListing({
      listingId: 'listing-1', suspensionActionId: 'action-1',
    })],
  ])('rejects malformed local requests before SDK use: %s', async (_label, operation) => {
    await expect(operation()).rejects.toThrow();
    expect(functions.httpsCallable).not.toHaveBeenCalled();
  });

  it('maps callable failures to one generic account-management error', async () => {
    functions.callableByName.get('suspendModerationTarget')!
      .mockRejectedValue(new Error('private reason and path'));
    await expect(suspendModerationTarget({
      reportId: 'report-1', requestId, reason: '重複違規',
    })).rejects.toThrow('帳號管理服務目前無法使用，請稍後再試。');
  });
});
