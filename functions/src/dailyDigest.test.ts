import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListingEvent } from './domain.js';
import {
  beginDailyDigestSend,
  completeDailyDigestDelivery,
  completeDailyDigestWithoutSend,
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
  cardName: string,
  createdAt = '2026-08-25T02:00:00.000Z',
  capturedAt = createdAt,
  capturedSequence = 1,
  cardType: ListingEvent['cardType'] = 'character',
): ListingEvent {
  return {
    id,
    listingId: id,
    cardType,
    cardName,
    rarity: 'SR',
    cardId: 'P001',
    listingPrice: 120,
    remainingQuantity: 2,
    createdAt: Timestamp.fromDate(new Date(createdAt)),
    capturedAt: Timestamp.fromDate(new Date(capturedAt)),
    capturedSequence,
    discordStatus: 'sent',
    attempts: 1,
  };
}

function subscription(uid: string, cardNames = ['江戶川柯南']): NotificationSubscription {
  return {
    uid,
    cardNames,
    emailDailyEnabled: true,
    updatedAt: new Date('2026-08-25T00:00:00.000Z'),
  };
}

function createDependencies(
  subscriptions: NotificationSubscription[] = [subscription('buyer-1')],
  events: ListingEvent[] = [listingEvent('listing-1', '江戶川柯南')],
): DailyDigestDependencies & {
  runs: {
    getOrCreate(runDate: string): Promise<{ runDate: string; windowEndSequence: number }>;
  };
  nextWatermark: ReturnType<typeof vi.fn<() => Promise<number>>>;
} {
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
  const runWatermarks = new Map<string, number>();

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
      findNewInSequenceRange: vi.fn(async (afterSequence, throughSequence, limit) => events
        .filter((event) => (
          event.capturedSequence > afterSequence
          && event.capturedSequence <= throughSequence
        ))
        .sort((left, right) => left.capturedSequence - right.capturedSequence)
        .slice(0, limit)),
    },
    deliveryState: {
      claim: vi.fn(async (uid, claimId, reservedAt, windowEnd, runDate) => {
        const claimed = reserveDailyDigestDelivery(
          deliveryRecords.get(uid) ?? {},
          claimId,
          reservedAt,
          windowEnd,
          runDate,
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
      completeWithoutSend: vi.fn(async (uid, claimId) => {
        const completed = completeDailyDigestWithoutSend(
          deliveryRecords.get(uid) ?? {},
          claimId,
        );
        if (completed) deliveryRecords.set(uid, completed);
      }),
      beginSend: vi.fn(async (uid, claimId) => {
        const sending = beginDailyDigestSend(deliveryRecords.get(uid) ?? {}, claimId);
        if (!sending) return false;
        deliveryRecords.set(uid, sending);
        return true;
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
    runs: {
      getOrCreate: vi.fn(async (runDate) => {
        let windowEndSequence = runWatermarks.get(runDate);
        if (windowEndSequence === undefined) {
          windowEndSequence = await createWatermark();
          runWatermarks.set(runDate, windowEndSequence);
        }
        return { runDate, windowEndSequence };
      }),
    },
    nextWatermark: createWatermark,
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
        listingEvent('listing-late', '江戶川柯南', '2026-08-25T03:00:00.000Z'),
        listingEvent('listing-1', '江戶川柯南', '2026-08-25T02:00:00.000Z'),
        listingEvent('listing-other', '安室透', '2026-08-25T02:30:00.000Z'),
        listingEvent(
          'listing-old',
          '江戶川柯南',
          '2026-08-25T00:30:00.000Z',
          '2026-08-25T00:30:00.000Z',
          0,
        ),
      ],
    );
  });

  it('groups only new events with subscribed card names into one email', async () => {
    await runDailyDigest(now, deps);

    expect(deps.gmail.sendDigest).toHaveBeenCalledTimes(1);
    expect(deps.gmail.sendDigest).toHaveBeenCalledWith(expect.objectContaining({
      to: 'buyer@example.com',
      subject: '柯南 TCG 新上架摘要',
      groups: [{
        cardName: '江戶川柯南',
        listings: [
          expect.objectContaining({ id: 'listing-1' }),
          expect.objectContaining({ id: 'listing-late' }),
        ],
      }],
    }));
    expect(deps.deliveryState.complete).toHaveBeenCalledWith('buyer-1', 'claim-1');
    expect(deps.deliveryState.beginSend).toHaveBeenCalledWith('buyer-1', 'claim-1');
  });

  it('matches Character and Partner events by the same raw card-name substring', async () => {
    const character = listingEvent(
      'listing-character',
      '江戶川柯南',
      undefined,
      undefined,
      1,
      'character',
    );
    const partner = listingEvent(
      'listing-partner',
      '江戶川柯南＆灰原哀',
      undefined,
      undefined,
      2,
      'partner',
    );
    character.rarity = 'SR';
    partner.rarity = 'PR';
    deps = createDependencies([subscription('buyer-1')], [character, partner]);

    await runDailyDigest(now, deps);

    const listings = vi.mocked(deps.gmail.sendDigest).mock.calls[0]?.[0]
      .groups.flatMap((group) => group.listings);
    expect(listings).toEqual([
      expect.objectContaining({ listingId: 'listing-character', cardType: 'character', rarity: 'SR' }),
      expect.objectContaining({ listingId: 'listing-partner', cardType: 'partner', rarity: 'PR' }),
    ]);
  });

  it('matches a subscribed name inside a longer raw listing name', async () => {
    deps = createDependencies(
      [subscription('buyer-1', ['江戶川柯南'])],
      [listingEvent('listing-combined', '江戶川柯南＆灰原哀')],
    );

    await runDailyDigest(now, deps);

    expect(vi.mocked(deps.gmail.sendDigest).mock.calls[0]?.[0].groups).toEqual([{
      cardName: '江戶川柯南＆灰原哀',
      listings: [expect.objectContaining({ listingId: 'listing-combined' })],
    }]);
  });

  it('does not normalize Unicode, case, punctuation, or width while matching', async () => {
    deps = createDependencies(
      [subscription('buyer-1', ['CONAN', '江戶川柯南'])],
      [
        listingEvent('listing-case', 'Conan', undefined, undefined, 1),
        listingEvent('listing-width', 'ＣＯＮＡＮ', undefined, undefined, 2),
        listingEvent('listing-punctuation', '江戶川・柯南', undefined, undefined, 3),
        listingEvent('listing-unicode', '江戶川コナン', undefined, undefined, 4),
      ],
    );

    await runDailyDigest(now, deps);

    expect(deps.gmail.sendDigest).not.toHaveBeenCalled();
    expect(deps.deliveryState.completeWithoutSend).toHaveBeenCalledWith('buyer-1', 'claim-1');
  });

  it('deduplicates one Listing matched by overlapping subscribed names', async () => {
    deps = createDependencies(
      [subscription('buyer-1', ['柯南', '江戶川柯南'])],
      [listingEvent('listing-1', '江戶川柯南')],
    );

    await runDailyDigest(now, deps);

    const message = vi.mocked(deps.gmail.sendDigest).mock.calls[0]?.[0];
    expect(message?.groups[0]?.listings).toHaveLength(1);
  });

  it('reads one shared sequence window for two subscribers in one page', async () => {
    deps = createDependencies([
      subscription('buyer-1'),
      subscription('buyer-2'),
    ]);

    await runDailyDigest(now, deps);

    expect(deps.events.findNewInSequenceRange).toHaveBeenCalledTimes(1);
    expect(deps.events.findNewInSequenceRange).toHaveBeenCalledWith(0, 100, 250);
    expect(deps.gmail.sendDigest).toHaveBeenCalledTimes(2);
  });

  it('pages more than 250 events deterministically without duplicates', async () => {
    const events = Array.from({ length: 251 }, (_, index) => listingEvent(
      `listing-${index + 1}`,
      '江戶川柯南',
      undefined,
      undefined,
      index + 1,
    ));
    deps = createDependencies([subscription('buyer-1')], events);
    deps.nextWatermark.mockResolvedValue(300);

    await runDailyDigest(now, deps);

    expect(deps.events.findNewInSequenceRange).toHaveBeenNthCalledWith(1, 0, 300, 250);
    expect(deps.events.findNewInSequenceRange).toHaveBeenNthCalledWith(2, 250, 300, 250);
    const listings = vi.mocked(deps.gmail.sendDigest).mock.calls[0]?.[0]
      .groups.flatMap((group) => group.listings) ?? [];
    expect(listings).toHaveLength(251);
    expect(new Set(listings.map((event) => event.listingId)).size).toBe(251);
  });

  it('releases every reserved claim when a shared event-page read fails', async () => {
    deps = createDependencies([
      subscription('buyer-1'),
      subscription('buyer-2'),
    ]);
    vi.mocked(deps.events.findNewInSequenceRange)
      .mockRejectedValue(new Error('event read unavailable'));

    await expect(runDailyDigest(now, deps)).rejects.toThrow('event read unavailable');

    expect(deps.deliveryState.release).toHaveBeenCalledTimes(2);
    expect(deps.deliveryState.release).toHaveBeenNthCalledWith(1, 'buyer-1', 'claim-1');
    expect(deps.deliveryState.release).toHaveBeenNthCalledWith(2, 'buyer-2', 'claim-2');
    expect(deps.gmail.sendDigest).not.toHaveBeenCalled();
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
    expect(deps.events.findNewInSequenceRange).not.toHaveBeenCalled();
  });

  it('skips malformed, duplicate, oversized, and overlong subscription card-name lists', async () => {
    const invalidSubscriptions = [
      { ...subscription('buyer-non-list'), cardNames: '江戶川柯南' as never },
      subscription('buyer-non-string', [42 as never]),
      subscription('buyer-not-trimmed', [' 江戶川柯南']),
      subscription('buyer-duplicate', ['江戶川柯南', '江戶川柯南']),
      subscription(
        'buyer-too-many',
        Array.from({ length: 101 }, (_, index) => `卡名-${index}`),
      ),
      subscription('buyer-overlong', ['卡'.repeat(101)]),
      subscription('buyer-valid'),
    ];
    deps = createDependencies(invalidSubscriptions, [listingEvent('listing-1', '江戶川柯南')]);

    await runDailyDigest(now, deps);

    expect(deps.recipients.getVerifiedEmail).toHaveBeenCalledTimes(1);
    expect(deps.recipients.getVerifiedEmail).toHaveBeenCalledWith('buyer-valid');
    expect(deps.gmail.sendDigest).toHaveBeenCalledTimes(1);
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
      expect.any(String),
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
      '2026-08-26',
    );
  });

  it('does not send or advance when no new listing event exists', async () => {
    deps = createDependencies([subscription('buyer-1')], []);

    await runDailyDigest(now, deps);

    expect(deps.gmail.sendDigest).not.toHaveBeenCalled();
    expect(deps.deliveryState.complete).not.toHaveBeenCalled();
    expect(deps.deliveryState.completeWithoutSend).toHaveBeenCalledWith('buyer-1', 'claim-1');
  });

  it('does not send a duplicate digest after a completed run advances the cursor', async () => {
    deps = createDependencies();

    await runDailyDigest(now, deps);
    await runDailyDigest(now, deps);

    expect(deps.gmail.sendDigest).toHaveBeenCalledTimes(1);
    expect(deps.deliveryState.complete).toHaveBeenCalledTimes(1);
  });

  it('uses one fixed watermark for duplicate invocations on the same Asia/Taipei date', async () => {
    const events = [listingEvent('listing-first', '江戶川柯南', undefined, undefined, 1)];
    deps = createDependencies([subscription('buyer-1')], events);
    deps.nextWatermark
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2);

    await runDailyDigest(new Date('2026-08-25T16:30:00.000Z'), deps);
    events.push(listingEvent(
      'listing-same-date-late',
      '江戶川柯南',
      '2026-08-25T16:45:00.000Z',
      '2026-08-25T16:45:00.000Z',
      2,
    ));
    await runDailyDigest(new Date('2026-08-25T17:00:00.000Z'), deps);

    expect(deps.runs.getOrCreate).toHaveBeenNthCalledWith(1, '2026-08-26');
    expect(deps.runs.getOrCreate).toHaveBeenNthCalledWith(2, '2026-08-26');
    expect(deps.gmail.sendDigest).toHaveBeenCalledTimes(1);

    await runDailyDigest(new Date('2026-08-26T16:30:00.000Z'), deps);
    expect(deps.runs.getOrCreate).toHaveBeenNthCalledWith(3, '2026-08-27');
    expect(deps.gmail.sendDigest).toHaveBeenCalledTimes(2);
  });

  it('delivers an event captured after a run even when its Listing creation time is older', async () => {
    const events = [listingEvent(
      'listing-first',
      '江戶川柯南',
      '2026-08-25T02:00:00.000Z',
      '2026-08-25T02:01:00.000Z',
    )];
    deps = createDependencies([subscription('buyer-1')], events);
    deps.nextWatermark
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(11);

    await runDailyDigest(now, deps);
    events.push(listingEvent(
      'listing-captured-late',
      '江戶川柯南',
      '2026-08-25T03:00:00.000Z',
      '2026-08-26T01:06:00.000Z',
      11,
    ));
    await runDailyDigest(new Date('2026-08-27T01:00:00.000Z'), deps);

    expect(deps.gmail.sendDigest).toHaveBeenCalledTimes(2);
    expect(vi.mocked(deps.gmail.sendDigest).mock.calls[1]?.[0].groups).toEqual([{
      cardName: '江戶川柯南',
      listings: [expect.objectContaining({ id: 'listing-captured-late' })],
    }]);
  });

  it('closes every recipient window at the committed ingestion watermark', async () => {
    const watermark = 47;
    deps.nextWatermark.mockResolvedValue(watermark);

    await runDailyDigest(now, deps);

    expect(deps.events.findNewInSequenceRange).toHaveBeenCalledWith(0, watermark, 250);
  });

  it('delivers a late-visible event sharing the prior watermark timestamp', async () => {
    const sharedCapturedAt = '2026-08-26T00:50:00.000Z';
    const events = [listingEvent(
      'listing-visible-first',
      '江戶川柯南',
      '2026-08-25T02:00:00.000Z',
      sharedCapturedAt,
      10,
    )];
    deps = createDependencies([subscription('buyer-1')], events);
    deps.nextWatermark
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(11);

    await runDailyDigest(now, deps);
    events.push(listingEvent(
      'listing-visible-late',
      '江戶川柯南',
      '2026-08-25T03:00:00.000Z',
      sharedCapturedAt,
      11,
    ));
    await runDailyDigest(new Date('2026-08-27T01:00:00.000Z'), deps);

    expect(deps.gmail.sendDigest).toHaveBeenCalledTimes(2);
    expect(vi.mocked(deps.gmail.sendDigest).mock.calls[1]?.[0].groups).toEqual([{
      cardName: '江戶川柯南',
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

  it('reclaims a stale pre-send reservation on retry despite a historical scheduler time', async () => {
    const scheduledTime = new Date('2026-08-26T01:00:00.000Z');
    const retryExecutionTime = new Date('2026-08-26T01:16:00.000Z');

    await deps.deliveryState.claim(
      'buyer-1',
      'claim-crashed-worker',
      scheduledTime,
      100,
      '2026-08-26',
    );

    await runDailyDigest(scheduledTime, deps, retryExecutionTime);

    expect(deps.gmail.sendDigest).toHaveBeenCalledTimes(1);
    expect(deps.deliveryState.beginSend).toHaveBeenCalledWith('buyer-1', 'claim-1');
  });

  it('does not send from a stale worker recovered while paused before send', async () => {
    let resumeFirstBegin: (() => void) | undefined;
    const beginSend = vi.mocked(deps.deliveryState.beginSend);
    const beginSendImplementation = beginSend.getMockImplementation()!;
    beginSend.mockImplementationOnce(async (uid, claimId) => {
      await new Promise<void>((resolve) => {
        resumeFirstBegin = resolve;
      });
      return beginSendImplementation(uid, claimId);
    });

    const firstRun = runDailyDigest(now, deps);
    await vi.waitFor(() => expect(deps.deliveryState.beginSend).toHaveBeenCalledTimes(1));
    await expect(deps.deliveryState.recover(
      'buyer-1',
      'claim-1',
      'definitely-unsent',
    )).resolves.toBe(true);

    await runDailyDigest(now, deps);
    expect(deps.gmail.sendDigest).toHaveBeenCalledTimes(1);
    expect(beginSend).toHaveBeenNthCalledWith(2, 'buyer-1', 'claim-2');

    resumeFirstBegin?.();
    await firstRun;
    expect(deps.gmail.sendDigest).toHaveBeenCalledTimes(1);
  });

  it('builds text and HTML summaries without image URLs', async () => {
    await runDailyDigest(now, deps);

    const message = vi.mocked(deps.gmail.sendDigest).mock.calls[0]?.[0];
    expect(message?.text).toContain('卡名：江戶川柯南');
    expect(message?.text).toContain('類型：character');
    expect(message?.text).toContain('價格：NT$ 120');
    expect(message?.text).toContain('稀有度：SR');
    expect(message?.text).toContain('卡片 ID：P001');
    expect(message?.text).toContain('剩餘數量：2');
    expect(message?.text).toContain('/#/listing/listing-1');
    expect(message?.text).toContain('/#/notifications');
    expect(message?.html).toContain('/#/listing/listing-1');
    expect(message?.html).toContain('卡片 ID：P001');
    expect(message?.html).toContain('/#/notifications');
    expect(`${message?.text}${message?.html}`).not.toMatch(/<img|imageUrl|firebasestorage/i);
  });

  it('HTML-escapes every dynamic rendered value even when runtime data violates its TypeScript type', async () => {
    const adversarial = listingEvent(
      'listing\"><img src=x onerror=alert(2)>',
      '<img src=x onerror=alert(1)>',
    );
    adversarial.rarity = '"><svg onload=alert(1)>';
    adversarial.cardId = '<script>alert(1)</script>';
    adversarial.listingPrice = '<b>120</b>' as never;
    adversarial.remainingQuantity = '<i>2</i>' as never;
    deps = createDependencies([subscription('buyer-1', [adversarial.cardName])], [adversarial]);

    await runDailyDigest(now, deps);

    const html = vi.mocked(deps.gmail.sendDigest).mock.calls[0]?.[0].html ?? '';
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&quot;&gt;&lt;svg onload=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('價格：NT$ &lt;b&gt;120&lt;/b&gt;');
    expect(html).toContain('剩餘數量：&lt;i&gt;2&lt;/i&gt;');
    expect(html).toContain('listing%22%3E%3Cimg%20src%3Dx%20onerror%3Dalert(2)%3E');
    expect(html).not.toMatch(/<img|<svg|<script|<b>|<i>/i);
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

  it('does not replace a reservation while the first worker may still be active', () => {
    const first = reserveDailyDigestDelivery(
      { cursorSequence: 7 },
      'claim-1',
      now,
      10,
    );
    expect(reserveDailyDigestDelivery(
      first!,
      'claim-2',
      new Date('2026-08-26T01:10:00.000Z'),
      11,
      '2026-08-26',
    )).toBeNull();
  });

  it('automatically replaces only a stale pre-send reservation', () => {
    const first = reserveDailyDigestDelivery(
      { cursorSequence: 7 },
      'claim-1',
      now,
      10,
      '2026-08-26',
    );

    const replaced = reserveDailyDigestDelivery(
      first!,
      'claim-2',
      new Date('2026-08-26T01:16:00.000Z'),
      10,
      '2026-08-26',
    );

    expect(replaced).toMatchObject({
      cursorSequence: 7,
      claimId: 'claim-2',
      claimState: 'reserved',
      claimRunDate: '2026-08-26',
    });
  });

  it('never automatically replaces a stale claim that entered sending', () => {
    const first = reserveDailyDigestDelivery(
      { cursorSequence: 7 },
      'claim-1',
      now,
      10,
      '2026-08-26',
    );

    expect(reserveDailyDigestDelivery(
      { ...first!, claimState: 'sending' },
      'claim-2',
      new Date('2026-08-26T02:00:00.000Z'),
      10,
      '2026-08-26',
    )).toBeNull();
  });

  it('does not reserve a second digest after the user completed the same run', () => {
    const completed = {
      cursorSequence: 10,
      completedRunDate: '2026-08-26',
    };

    expect(reserveDailyDigestDelivery(
      completed,
      'claim-2',
      new Date('2026-08-26T02:00:00.000Z'),
      10,
      '2026-08-26',
    )).toBeNull();
  });

  it('does not let a delayed older run regress a later completed cursor', () => {
    const completedLaterRun = {
      cursorSequence: 20,
      completedRunDate: '2026-08-27',
    };

    expect(reserveDailyDigestDelivery(
      completedLaterRun,
      'claim-delayed',
      new Date('2026-08-27T02:00:00.000Z'),
      10,
      '2026-08-26',
    )).toBeNull();
  });

  it('prevents a stale claimant from overwriting a manually recovered reservation', () => {
    const recovered: DailyDigestDeliveryRecord = {
      cursorSequence: 7,
      claimId: 'claim-2',
      claimState: 'sending',
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
      claimState: 'reserved',
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
      claimState: 'sending',
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
      claimState: 'reserved',
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
      claimState: 'reserved',
      reservedAt: Timestamp.fromDate(now),
      windowEndSequence: 12,
    };

    expect(recoverDailyDigestDelivery(
      reserved,
      'claim-1',
      'unknown' as never,
    )).toBeNull();
  });

  it('moves only the matching reserved claim into sending state', () => {
    const reserved = reserveDailyDigestDelivery(
      { cursorSequence: 7 },
      'claim-1',
      now,
      12,
    );

    expect(beginDailyDigestSend(reserved!, 'claim-1')).toEqual({
      ...reserved,
      claimState: 'sending',
    });
    expect(beginDailyDigestSend(reserved!, 'claim-2')).toBeNull();
    expect(beginDailyDigestSend({ ...reserved!, claimState: 'sending' }, 'claim-1'))
      .toBeNull();
  });

  it('requires sent-or-ambiguous recovery after a claim starts sending', () => {
    const sending: DailyDigestDeliveryRecord = {
      cursorSequence: 7,
      claimId: 'claim-1',
      claimState: 'sending',
      reservedAt: Timestamp.fromDate(now),
      windowEndSequence: 12,
    };

    expect(recoverDailyDigestDelivery(
      sending,
      'claim-1',
      'definitely-unsent',
    )).toBeNull();
    expect(recoverDailyDigestDelivery(
      sending,
      'claim-1',
      'sent-or-ambiguous',
    )).toEqual({ cursorSequence: 12 });
  });

  it('does not classify a pre-send reservation as sent or ambiguous', () => {
    const reserved: DailyDigestDeliveryRecord = {
      cursorSequence: 7,
      claimId: 'claim-1',
      claimState: 'reserved',
      reservedAt: Timestamp.fromDate(now),
      windowEndSequence: 12,
    };

    expect(recoverDailyDigestDelivery(
      reserved,
      'claim-1',
      'sent-or-ambiguous',
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
