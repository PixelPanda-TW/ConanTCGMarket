import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListingEvent } from './domain.js';
import {
  DAILY_DIGEST_SCHEDULE_OPTIONS,
  runDailyDigest,
  type DailyDigestDependencies,
  type NotificationSubscription,
} from './dailyDigest.js';

const now = new Date('2026-08-26T01:00:00.000Z');

function listingEvent(
  id: string,
  characterName: string,
  createdAt = '2026-08-25T02:00:00.000Z',
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
  return {
    subscriptions: {
      listEmailDailyEnabled: vi.fn().mockResolvedValue(subscriptions),
    },
    events: {
      findNewByCharacterKeys: vi.fn(async (characterKeys, after, through) => events.filter((event) => (
        characterKeys.includes(event.characterKey)
          && event.createdAt.toDate() > after
          && event.createdAt.toDate() <= through
      ))),
    },
    deliveryState: {
      getCursor: vi.fn().mockResolvedValue(new Date('2026-08-25T01:00:00.000Z')),
      advance: vi.fn().mockResolvedValue(undefined),
    },
    recipients: {
      getVerifiedEmail: vi.fn().mockResolvedValue('buyer@example.com'),
    },
    gmail: {
      sendDigest: vi.fn().mockResolvedValue(undefined),
    },
    recipientCap: 100,
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
        listingEvent('listing-old', '諸伏景光', '2026-08-25T00:30:00.000Z'),
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
    expect(deps.deliveryState.advance).toHaveBeenCalledWith('buyer-1', now);
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

  it('does not advance the cursor when Gmail send fails', async () => {
    vi.mocked(deps.gmail.sendDigest).mockRejectedValue(new Error('mail unavailable'));

    await expect(runDailyDigest(now, deps)).resolves.toBeUndefined();

    expect(deps.deliveryState.advance).not.toHaveBeenCalled();
  });

  it('skips an unverified or missing Google email without exposing it', async () => {
    vi.mocked(deps.recipients.getVerifiedEmail).mockResolvedValue(null);

    await runDailyDigest(now, deps);

    expect(deps.gmail.sendDigest).not.toHaveBeenCalled();
    expect(deps.deliveryState.advance).not.toHaveBeenCalled();
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

  it('leaves recipients beyond the daily cap deferred with unchanged cursors', async () => {
    deps = createDependencies([
      subscription('buyer-1'),
      subscription('buyer-2'),
    ]);
    deps.recipientCap = 1;

    await runDailyDigest(now, deps);

    expect(deps.recipients.getVerifiedEmail).toHaveBeenCalledTimes(1);
    expect(deps.recipients.getVerifiedEmail).toHaveBeenCalledWith('buyer-1');
    expect(deps.deliveryState.advance).toHaveBeenCalledTimes(1);
    expect(deps.deliveryState.advance).not.toHaveBeenCalledWith('buyer-2', expect.any(Date));
  });

  it('does not send or advance when no new listing event exists', async () => {
    deps = createDependencies([subscription('buyer-1')], []);

    await runDailyDigest(now, deps);

    expect(deps.gmail.sendDigest).not.toHaveBeenCalled();
    expect(deps.deliveryState.advance).not.toHaveBeenCalled();
  });

  it('does not send a duplicate digest after a completed run advances the cursor', async () => {
    let cursor = new Date(0);
    deps = createDependencies();
    vi.mocked(deps.deliveryState.getCursor).mockImplementation(async () => cursor);
    vi.mocked(deps.deliveryState.advance).mockImplementation(async (_uid, nextCursor) => {
      cursor = nextCursor;
    });

    await runDailyDigest(now, deps);
    await runDailyDigest(now, deps);

    expect(deps.gmail.sendDigest).toHaveBeenCalledTimes(1);
    expect(deps.deliveryState.advance).toHaveBeenCalledTimes(1);
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

describe('daily digest scheduler', () => {
  it('runs every day at 09:00 in Asia/Taipei', () => {
    expect(DAILY_DIGEST_SCHEDULE_OPTIONS).toEqual({
      schedule: '0 9 * * *',
      timeZone: 'Asia/Taipei',
    });
  });
});
