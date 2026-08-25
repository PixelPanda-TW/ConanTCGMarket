import { describe, expect, it, vi } from 'vitest';
import {
  DailyDigestOperatorError,
  handleDailyDigestOperatorRequest,
  type DailyDigestOperatorDependencies,
} from './dailyDigestOperator.js';

function dependencies(): DailyDigestOperatorDependencies {
  return {
    listActiveClaims: vi.fn().mockResolvedValue([]),
    recover: vi.fn().mockResolvedValue(true),
  };
}

describe('daily digest operator workflow', () => {
  it('returns a bounded monitoring page and reports truncation without recipient data', async () => {
    const deps = dependencies();
    vi.mocked(deps.listActiveClaims).mockResolvedValue([
      {
        uid: 'buyer-1',
        claimId: 'claim-1',
        claimState: 'reserved',
        claimRunDate: '2026-08-26',
        reservedAt: '2026-08-26T01:00:00.000Z',
        staleReserved: true,
        windowEndSequence: 10,
      },
      {
        uid: 'buyer-2',
        claimId: 'claim-2',
        claimState: 'sending',
        claimRunDate: '2026-08-26',
        reservedAt: '2026-08-26T01:01:00.000Z',
        staleReserved: false,
        windowEndSequence: 11,
      },
      {
        uid: 'buyer-3',
        claimId: 'claim-3',
        claimState: 'sending',
        reservedAt: null,
        staleReserved: false,
      },
    ]);

    const result = await handleDailyDigestOperatorRequest(
      { action: 'list', limit: 2 },
      deps,
    );

    expect(deps.listActiveClaims).toHaveBeenCalledWith(3);
    expect(result).toEqual({
      claims: [
        expect.objectContaining({ uid: 'buyer-1', claimId: 'claim-1' }),
        expect.objectContaining({ uid: 'buyer-2', claimId: 'claim-2' }),
      ],
      truncated: true,
    });
    expect(JSON.stringify(result)).not.toMatch(/@|email/i);
  });

  it('requires an exact claim and explicit recovery decision', async () => {
    const deps = dependencies();

    await expect(handleDailyDigestOperatorRequest({
      action: 'recover',
      uid: 'buyer-1',
      claimId: 'claim-1',
      decision: 'sent-or-ambiguous',
    }, deps)).resolves.toEqual({ recovered: true });

    expect(deps.recover).toHaveBeenCalledWith(
      'buyer-1',
      'claim-1',
      'sent-or-ambiguous',
    );
  });

  it('rejects recovery without one of the two deliberate decisions', async () => {
    const deps = dependencies();

    await expect(handleDailyDigestOperatorRequest({
      action: 'recover',
      uid: 'buyer-1',
      claimId: 'claim-1',
    }, deps)).rejects.toMatchObject<Partial<DailyDigestOperatorError>>({
      status: 400,
    });
    expect(deps.recover).not.toHaveBeenCalled();
  });

  it('reports a stale or incompatible claim decision as a conflict', async () => {
    const deps = dependencies();
    vi.mocked(deps.recover).mockResolvedValue(false);

    await expect(handleDailyDigestOperatorRequest({
      action: 'recover',
      uid: 'buyer-1',
      claimId: 'claim-stale',
      decision: 'definitely-unsent',
    }, deps)).rejects.toMatchObject<Partial<DailyDigestOperatorError>>({
      status: 409,
    });
  });
});
