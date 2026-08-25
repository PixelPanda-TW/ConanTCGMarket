import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListingEvent } from './domain.js';
import {
  completeDailyDigestDelivery,
  DAILY_DIGEST_SCHEDULE_OPTIONS,
  recoverDailyDigestDelivery,
  releaseDailyDigestDelivery,
  reserveDailyDigestDelivery,
  runDailyDigest,
  type DailyDigestDependencies,
  type DailyDigestDeliveryRecord,
  type NotificationSubscription,
} from './dailyDigest.js';

const now = new Date('2026-08-26T01:00:00.000Z');

function listingEvent(
  id: string,
  characterName: string,
  createdAt = '2026-08-25T02:00:00.000Z',
  capturedAt = createdAt,
  capturedSequence = 1,
): ListingEvent {
  return {
    id,
    listingId: id,
    characterKey: characterName,
    characterName,
    rarity: 'SR',
    cardId: 'CT-P01-001',
    listingPrice: 120,
    remainingQuantity: 2,
    createdAt: Timestamp.fromDate(new Date(createdAt)),
    capturedAt: Timestamp.fromDate(new Date(capturedAt)),
    capturedSequence,
    discordStatus: 'sent',
    attempts: 1,
  };
}

function subscription(uid: string, characterKeys = ['諸伏景光']): NotificationSubscription {
  return {
    uid,
    characterKeys,
    emailDailyEnabled: true,
    updatedAt: new Date('2026-08-25T00:00:00.000Z'),
  };
}

function createDependencies(
  subscriptions: NotificationSubscription[] = [subscription('buyer-1')],
  events: ListingEvent[] = [listingEvent('listing-1', '諸伏景光')],
): DailyDigestDependencies {
  const sortedSubscriptions = [...subscriptions].sort((left, right) => left.uid.localeCompare(right.uid));
  const deliveryRecords = new Map<string, DailyDigestDeliveryRecord>();
  for (const item of subscriptions) {
    deliveryRecords.set(item.uid, {
      cursorSequence: 0,
    });
  }
  let claimSequence = 0;
  let batchCursor: string | null = null;
  const createWatermark = vi.fn(async () => 100);

  return {
    subscriptions: {
      listEmailDailyEnabled: vi.fn(async (afterUid: string | null, limit: number) => {
        const start = afterUid
          ? sortedSubscriptions.findIndex((item) => item.uid === afterUid) + 1
          : 0;
        return sortedSubscriptions.slice(start, start + limit);
      }),
    },
    events: {
      findNewByCharacterKeys: vi.fn(async (characterKeys, afterSequence, throughSequence) => events.filter((event) => (
        characterKeys.includes(event.characterKey)
          && event.capturedSequence > afterSequence
          && event.capturedSequence <= throughSequence
      ))),
    },
    deliveryState: {
      claim: vi.fn(async (uid, claimId, reservedAt, windowEnd) => {
        const claimed = reserveDailyDigestDelivery(
          deliveryRecords.get(uid) ?? {},
          claimId,
          reservedAt,
          windowEnd,
        );
        if (!claimed) return null;
        deliveryRecords.set(uid, claimed);
        return {
          claimId,
          afterSequence: claimed.cursorSequence ?? 0,
          throughSequence: claimed.windowEndSequence!,
        };
      }),
      complete: vi.fn(async (uid, claimId) => {
        const completed = completeDailyDigestDelivery(deliveryRecords.get(uid) ?? {}, claimId);
        if (completed) deliveryRecords.set(uid, completed);
      }),
      release: vi.fn(async (uid, claimId) => {
        const released = releaseDailyDigestDelivery(deliveryRecords.get(uid) ?? {}, claimId);
        if (released) deliveryRecords.set(uid, released);
      }),
      recover: vi.fn(async (uid, claimId, mode) => {
        const recovered = recoverDailyDigestDelivery(
          deliveryRecords.get(uid) ?? {},
          claimId,
          mode,
        );
        if (!recovered) return false;
        deliveryRecords.set(uid, recovered);
        return true;
      }),
    },
    batchState: {
      getCursor: vi.fn(async () => batchCursor),
      advance: vi.fn(async (cursor) => {
        batchCursor = cursor;
      }),
    },
    ingestionWatermarks: {
      create: createWatermark,
    },
    recipients: {
      getVerifiedEmail: vi.fn().mockResolvedValue('buyer@example.com'),
    },
    gmail: {
      sendDigest: vi.fn().mockResolvedValue(undefined),
    },
    recipientCap: 100,
    createClaimId: vi.fn(() => `claim-${++claimSequence}`),
  };
}

describe('runDailyDigest', () => {
  let deps: DailyDigestDependencies;

  beforeEach(() => {
    deps = createDependencies(
      [subscription('buyer-1')],
      [
        listingEvent('listing-late', '諸伏景光', '2026-08-25T03:00:00.000Z'),
        listingEvent('listing-1', '諸伏景光', '2026-08-25T02:00:00.000Z'),
        listingEvent('listing-other', '安室透', '2026-08-25T02:30:00.000Z'),
        listingEvent(
          'listing-old',
          '諸伏景光',
          '2026-08-25T00:30:00.000Z',
          '2026-08-25T00:30:00.000Z',
          0,
        ),
      ],
    );
  });

  it('groups only new events for subscribed characters into one email', async () => {
    await runDailyDigest(now, deps);

    expect(deps.gmail.sendDigest).toHaveBeenCalledTimes(1);
    expect(deps.gmail.sendDigest).toHaveBeenCalledWith(expect.objectContaining({
      to: 'buyer@example.com',
      subject: '柯南 TCG 新上架摘要',
      groups: [{
        characterName: '諸伏景光',
        listings: [
          expect.objectContaining({ id: 'listing-1' }),
          expect.objectContaining({ id: 'listing-late' }),
        ],
      }],
    }));
    expect(deps.deliveryState.complete).toHaveBeenCalledWith('buyer-1', 'claim-1');
  });

  it('deduplicates Listing IDs returned by overlapping query chunks', async () => {
    const duplicate = listingEvent('listing-1', '諸伏景光');
    deps = createDependencies(
      [subscription('buyer-1', Array.from({ length: 31 }, (_, index) => `角色-${index}`))],
    );
    vi.mocked(deps.events.findNewByCharacterKeys).mockResolvedValue([duplicate]);

    await runDailyDigest(now, deps);

    const message = vi.mocked(deps.gmail.sendDigest).mock.calls[0]?.[0];
    expect(message?.groups[0]?.listings).toHaveLength(1);
  });

  it('keeps the reservation when Gmail failure may be ambiguous', async () => {
    vi.mocked(deps.gmail.sendDigest).mockRejectedValue(new Error('mail unavailable'));

    await expect(runDailyDigest(now, deps)).resolves.toBeUndefined();
    await expect(runDailyDigest(now, deps)).resolves.toBeUndefined();

    expect(deps.deliveryState.complete).not.toHaveBeenCalled();
    expect(deps.deliveryState.release).not.toHaveBeenCalled();
    expect(deps.gmail.sendDigest).toHaveBeenCalledTimes(1);
  });

  it('skips an unverified or missing Google email without exposing it', async () => {
    vi.mocked(deps.recipients.getVerifiedEmail).mockResolvedValue(null);

    await runDailyDigest(now, deps);

    expect(deps.gmail.sendDigest).not.toHaveBeenCalled();
    expect(deps.deliveryState.complete).not.toHaveBeenCalled();
    expect(deps.deliveryState.claim).not.toHaveBeenCalled();
    expect(deps.events.findNewByCharacterKeys).not.toHaveBeenCalled();
  });

  it('queries subscribed character keys in chunks no larger than 30', async () => {
    const characterKeys = Array.from({ length: 61 }, (_, index) => `角色-${index}`);
    deps = createDependencies([subscription('buyer-1', characterKeys)], []);

    await runDailyDigest(now, deps);

    const chunks = vi.mocked(deps.events.findNewByCharacterKeys).mock.calls
      .map(([keys]) => keys);
    expect(chunks.map((keys) => keys.length)).toEqual([30, 30, 1]);
    expect(chunks.flat()).toEqual(characterKeys);
  });

  it('continues from the persisted scan cursor so capped recipients are eventually processed', async () => {
    deps = createDependencies([
      subscription('buyer-1'),
      subscription('buyer-2'),
    ]);
    deps.recipientCap = 1;

    await runDailyDigest(now, deps);

    expect(deps.recipients.getVerifiedEmail).toHaveBeenCalledTimes(1);
    expect(deps.recipients.getVerifiedEmail).toHaveBeenCalledWith('buyer-1');
    expect(deps.deliveryState.complete).toHaveBeenCalledTimes(1);
    expect(deps.deliveryState.claim).not.toHaveBeenCalledWith(
      'buyer-2',
      expect.any(String),
      expect.any(Date),
      expect.any(Number),
    );

    await runDailyDigest(new Date('2026-08-27T01:00:00.000Z'), deps);

    expect(deps.recipients.getVerifiedEmail).toHaveBeenNthCalledWith(2, 'buyer-2');
    expect(deps.deliveryState.complete).toHaveBeenCalledTimes(2);
  });

  it('does not let empty subscriptions or missing recipients consume the cap page', async () => {
    deps = createDependencies([
      subscription('buyer-empty', []),
      subscription('buyer-missing'),
      subscription('buyer-valid'),
    ]);
    deps.recipientCap = 1;
    vi.mocked(deps.recipients.getVerifiedEmail).mockImplementation(async (uid) => (
      uid === 'buyer-valid' ? 'valid@example.com' : null
    ));

    await runDailyDigest(now, deps);

    expect(deps.gmail.sendDigest).toHaveBeenCalledTimes(1);
    expect(deps.recipients.getVerifiedEmail).toHaveBeenCalledWith('buyer-missing');
    expect(deps.recipients.getVerifiedEmail).toHaveBeenCalledWith('buyer-valid');
    expect(deps.deliveryState.claim).toHaveBeenCalledTimes(1);
    expect(deps.deliveryState.claim).toHaveBeenCalledWith(
      'buyer-valid',
      expect.any(String),
      expect.any(Date),
      expect.any(Number),
    );
  });

  it('does not send or advance when no new listing event exists', async () => {
    deps = createDependencies([subscription('buyer-1')], []);

    await runDailyDigest(now, deps);

    expect(deps.gmail.sendDigest).not.toHaveBeenCalled();
    expect(deps.deliveryState.complete).not.toHaveBeenCalled();
    expect(deps.deliveryState.release).toHaveBeenCalledWith('buyer-1', 'claim-1');
  });

  it('does not send a duplicate digest after a completed run advances the cursor', async () => {
    deps = createDependencies();

    await runDailyDigest(now, deps);
    await runDailyDigest(now, deps);

    expect(deps.gmail.sendDigest).toHaveBeenCalledTimes(1);
    expect(deps.deliveryState.complete).toHaveBeenCalledTimes(1);
  });

  it('delivers an event captured after a run even when its Listing creation time is older', async () => {
    const events = [listingEvent(
      'listing-first',
      '諸伏景光',
      '2026-08-25T02:00:00.000Z',
      '2026-08-25T02:01:00.000Z',
    )];
    deps = createDependencies([subscription('buyer-1')], events);
    vi.mocked(deps.ingestionWatermarks.create)
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(11);

    await runDailyDigest(now, deps);
    events.push(listingEvent(
      'listing-captured-late',
      '諸伏景光',
      '2026-08-25T03:00:00.000Z',
      '2026-08-26T01:06:00.000Z',
      11,
    ));
    await runDailyDigest(new Date('2026-08-27T01:00:00.000Z'), deps);

    expect(deps.gmail.sendDigest).toHaveBeenCalledTimes(2);
    expect(vi.mocked(deps.gmail.sendDigest).mock.calls[1]?.[0].groups).toEqual([{
      characterName: '諸伏景光',
      listings: [expect.objectContaining({ id: 'listing-captured-late' })],
    }]);
  });

  it('closes every recipient window at the committed ingestion watermark', async () => {
    const watermark = 47;
    vi.mocked(deps.ingestionWatermarks.create).mockResolvedValue(watermark);

    await runDailyDigest(now, deps);

    expect(deps.events.findNewByCharacterKeys).toHaveBeenCalledWith(
      ['諸伏景光'],
      0,
      watermark,
    );
  });

  it('delivers a late-visible event sharing the prior watermark timestamp', async () => {
    const sharedCapturedAt = '2026-08-26T00:50:00.000Z';
    const events = [listingEvent(
      'listing-visible-first',
      '諸伏景光',
      '2026-08-25T02:00:00.000Z',
      sharedCapturedAt,
      10,
    )];
    deps = createDependencies([subscription('buyer-1')], events);
    vi.mocked(deps.ingestionWatermarks.create)
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(11);

    await runDailyDigest(now, deps);
    events.push(listingEvent(
      'listing-visible-late',
      '諸伏景光',
      '2026-08-25T03:00:00.000Z',
      sharedCapturedAt,
      11,
    ));
    await runDailyDigest(new Date('2026-08-27T01:00:00.000Z'), deps);

    expect(deps.gmail.sendDigest).toHaveBeenCalledTimes(2);
    expect(vi.mocked(deps.gmail.sendDigest).mock.calls[1]?.[0].groups).toEqual([{
      characterName: '諸伏景光',
      listings: [expect.objectContaining({ id: 'listing-visible-late' })],
    }]);
  });

  it('allows only one overlapping invocation to send a user digest', async () => {
    let finishSend: (() => void) | undefined;
    vi.mocked(deps.gmail.sendDigest).mockImplementation(() => new Promise<void>((resolve) => {
      finishSend = resolve;
    }));

    const firstRun = runDailyDigest(now, deps);
    await vi.waitFor(() => expect(deps.gmail.sendDigest).toHaveBeenCalledTimes(1));
    const secondRun = runDailyDigest(now, deps);
    await secondRun;

    expect(deps.gmail.sendDigest).toHaveBeenCalledTimes(1);
    finishSend?.();
    await firstRun;
  });

  it('builds text and HTML summaries without image URLs', async () => {
    await runDailyDigest(now, deps);

    const message = vi.mocked(deps.gmail.sendDigest).mock.calls[0]?.[0];
    expect(message?.text).toContain('角色：諸伏景光');
    expect(message?.text).toContain('價格：NT$ 120');
    expect(message?.text).toContain('稀有度：SR');
    expect(message?.text).toContain('卡片 ID：CT-P01-001');
    expect(message?.text).toContain('剩餘數量：2');
    expect(message?.text).toContain('/#/listing/listing-1');
    expect(message?.text).toContain('/#/notifications');
    expect(message?.html).toContain('/#/listing/listing-1');
    expect(message?.html).toContain('/#/notifications');
    expect(`${message?.text}${message?.html}`).not.toMatch(/<img|imageUrl|firebasestorage/i);
  });
});

describe('daily digest delivery claims', () => {
  it('rejects an overlapping claim while the current reservation exists', () => {
    const first = reserveDailyDigestDelivery(
      {},
      'claim-1',
      now,
      10,
    );

    expect(reserveDailyDigestDelivery(
      first!,
      'claim-2',
      new Date('2026-08-26T01:01:00.000Z'),
      11,
    )).toBeNull();
  });

  it('does not replace a reservation when the first worker is still active a day later', () => {
    const first = reserveDailyDigestDelivery(
      { cursorSequence: 7 },
      'claim-1',
      now,
      10,
    );
    expect(reserveDailyDigestDelivery(
      first!,
      'claim-2',
      new Date('2026-08-27T01:00:00.000Z'),
      11,
    )).toBeNull();
  });

  it('prevents a stale claimant from overwriting a manually recovered reservation', () => {
    const recovered: DailyDigestDeliveryRecord = {
      cursorSequence: 7,
      claimId: 'claim-2',
      reservedAt: Timestamp.fromDate(new Date('2026-08-26T02:00:00.000Z')),
      windowEndSequence: 12,
    };

    expect(completeDailyDigestDelivery(recovered, 'claim-1')).toBeNull();
    expect(completeDailyDigestDelivery(recovered, 'claim-2')).toEqual({
      cursorSequence: 12,
    });
  });

  it('releases a definitely-unsent reservation without advancing its cursor', () => {
    const reserved: DailyDigestDeliveryRecord = {
      cursorSequence: 7,
      claimId: 'claim-1',
      reservedAt: Timestamp.fromDate(now),
      windowEndSequence: 12,
    };

    const recovered = recoverDailyDigestDelivery(
      reserved,
      'claim-1',
      'definitely-unsent',
    );

    expect(recovered).toEqual({ cursorSequence: 7 });
    expect(completeDailyDigestDelivery(recovered!, 'claim-1')).toBeNull();
  });

  it('advances a sent-or-ambiguous reservation and rejects the hung original worker', () => {
    const reserved: DailyDigestDeliveryRecord = {
      cursorSequence: 7,
      claimId: 'claim-1',
      reservedAt: Timestamp.fromDate(now),
      windowEndSequence: 12,
    };

    const recovered = recoverDailyDigestDelivery(
      reserved,
      'claim-1',
      'sent-or-ambiguous',
    );

    expect(recovered).toEqual({ cursorSequence: 12 });
    expect(completeDailyDigestDelivery(recovered!, 'claim-1')).toBeNull();
    expect(releaseDailyDigestDelivery(recovered!, 'claim-1')).toBeNull();
  });

  it('does not recover a reservation without the exact current claim ID', () => {
    const reserved: DailyDigestDeliveryRecord = {
      cursorSequence: 7,
      claimId: 'claim-2',
      reservedAt: Timestamp.fromDate(now),
      windowEndSequence: 12,
    };

    expect(recoverDailyDigestDelivery(
      reserved,
      'claim-1',
      'definitely-unsent',
    )).toBeNull();
  });

  it('does not clear a reservation for an unknown recovery mode', () => {
    const reserved: DailyDigestDeliveryRecord = {
      cursorSequence: 7,
      claimId: 'claim-1',
      reservedAt: Timestamp.fromDate(now),
      windowEndSequence: 12,
    };

    expect(recoverDailyDigestDelivery(
      reserved,
      'claim-1',
      'unknown' as never,
    )).toBeNull();
  });
});

describe('daily digest scheduler', () => {
  it('runs every day at 09:00 in Asia/Taipei', () => {
    expect(DAILY_DIGEST_SCHEDULE_OPTIONS).toEqual({
      schedule: '0 9 * * *',
      timeZone: 'Asia/Taipei',
    });
  });
});
