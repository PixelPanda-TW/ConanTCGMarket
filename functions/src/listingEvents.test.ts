import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import type { DiscordClient, ListingEvent, ListingSnapshot } from './domain.js';
import {
  captureListingEvent,
  deliverDiscordEvent,
  reserveDiscordDeliveryAttempt,
  retryFailedDiscordEvents,
  type ListingEventStore,
} from './listingEvents.js';

const now = new Date('2026-08-25T02:00:00.000Z');

const listing: ListingSnapshot = {
  sellerId: 'seller-1',
  cardType: 'character',
  cardName: '諸伏景光',
  cardId: 'P001',
  rarity: 'SR',
  listingPrice: 120,
  remainingQuantity: 2,
  status: 'active',
  createdAt: new Date('2026-08-25T01:00:00.000Z'),
};

const event: ListingEvent = {
  id: 'listing-1',
  listingId: 'listing-1',
  sellerId: 'seller-1',
  cardType: 'character',
  cardName: '諸伏景光',
  rarity: 'SR',
  cardId: 'P001',
  listingPrice: 120,
  remainingQuantity: 2,
  createdAt: Timestamp.fromDate(new Date('2026-08-25T01:00:00.000Z')),
  capturedAt: Timestamp.fromDate(now),
  capturedSequence: 1,
  discordStatus: 'pending',
  attempts: 0,
};

const claimedEvent: ListingEvent = {
  ...event,
  discordStatus: 'failed',
  discordClaimId: 'claim-1',
  discordLeaseUntil: Timestamp.fromDate(new Date('2026-08-25T02:05:00.000Z')),
  attempts: 1,
  nextAttemptAt: Timestamp.fromDate(new Date('2026-08-25T02:05:00.000Z')),
};

const eventDraft = (({
  capturedAt: _capturedAt,
  capturedSequence: _capturedSequence,
  ...draft
}) => draft)(event);

function createDependencies(overrides: Partial<ListingEventStore> = {}) {
  const events: ListingEventStore = {
    create: vi.fn().mockResolvedValue(undefined),
    claim: vi.fn().mockResolvedValue(claimedEvent),
    markSent: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    findPending: vi.fn().mockResolvedValue([]),
    findDueFailed: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
  const discord: DiscordClient = {
    publishNewListing: vi.fn().mockResolvedValue(undefined),
  };
  const listings = {
    update: vi.fn().mockResolvedValue(undefined),
  };

  return {
    events,
    discord,
    listings,
    now: () => new Date(now),
    createClaimId: vi.fn().mockReturnValue('claim-1'),
  };
}

describe('captureListingEvent', () => {
  it.each([
    ['character', '江戶川柯南', '0001'],
    ['partner', '江戶川柯南', 'P001'],
    ['event', '追蹤開始', '1100'],
    ['case', '洗牌情緣', '0019'],
  ] as const)('captures a valid %s Listing exactly once', async (cardType, cardName, cardId) => {
    const deps = createDependencies();
    const cardListing = {
      ...listing,
      cardType,
      cardName,
      cardId,
    };

    await expect(captureListingEvent({
      params: { listingId: `${cardType}-1` },
      data: cardListing,
    }, deps)).resolves.toEqual({ status: 'captured' });

    expect(deps.events.create).toHaveBeenCalledTimes(1);
    expect(deps.events.create).toHaveBeenCalledWith(expect.objectContaining({
      id: `${cardType}-1`,
      listingId: `${cardType}-1`,
      sellerId: 'seller-1',
      cardType,
      cardName,
      cardId,
    }));
  });

  it('creates one durable pending event from duplicate Listing-created deliveries', async () => {
    const stored = new Map<string, Omit<ListingEvent, 'capturedAt' | 'capturedSequence'>>();
    let successfulCreates = 0;
    const deps = createDependencies({
      create: vi.fn(async (createdEvent: Omit<ListingEvent, 'capturedAt' | 'capturedSequence'>) => {
        if (stored.has(createdEvent.id)) {
          throw Object.assign(new Error('document already exists'), { code: 6 });
        }
        stored.set(createdEvent.id, createdEvent);
        successfulCreates += 1;
      }),
    });

    const eventListing = {
      ...listing,
      cardType: 'event' as const,
      cardName: '追蹤開始',
      cardId: '1100',
    };

    await captureListingEvent({ params: { listingId: 'event-listing' }, data: eventListing }, deps);
    await captureListingEvent({ params: { listingId: 'event-listing' }, data: eventListing }, deps);

    expect(successfulCreates).toBe(1);
    const [createdEvent] = [...stored.values()];
    expect(createdEvent).toMatchObject({
      id: 'event-listing',
      listingId: 'event-listing',
      sellerId: 'seller-1',
      cardType: 'event',
      cardName: '追蹤開始',
      cardId: '1100',
    });
  });

  it('captures an email-only event without a Discord pending state', async () => {
    const created: Array<Omit<ListingEvent, 'capturedAt' | 'capturedSequence'>> = [];
    const deps = createDependencies({
      create: vi.fn(async (createdEvent) => {
        created.push(createdEvent);
      }),
    });

    await captureListingEvent(
      { params: { listingId: 'listing-1' }, data: listing },
      deps,
      { discordEnabled: false },
    );

    expect(created).toStrictEqual([{ ...eventDraft, discordStatus: 'disabled' }]);
    expect(created[0]).not.toHaveProperty('nextAttemptAt');
  });

  it('captures the Listing card name without normalization or whitespace rewriting', async () => {
    const rawCardName = ' ＣＯＮＡＮ  cafe\u0301 ';
    const deps = createDependencies();

    await captureListingEvent(
      {
        params: { listingId: 'listing-raw-name' },
        data: { ...listing, cardName: rawCardName },
      },
      deps,
      { discordEnabled: false },
    );

    expect(deps.events.create).toHaveBeenCalledWith(expect.objectContaining({
      cardName: rawCardName,
    }));
  });

  it('does not persist unrelated seller or contact fields', async () => {
    const deps = createDependencies();

    await captureListingEvent({
      params: { listingId: 'listing-private-fields' },
      data: {
        ...listing,
        sellerDisplayName: 'Seller Name',
        contactValue: 'private-contact',
        email: 'seller@example.com',
      },
    }, deps, { discordEnabled: false });

    expect(deps.events.create).toHaveBeenCalledWith(expect.objectContaining({
      sellerId: 'seller-1',
    }));
    const created = vi.mocked(deps.events.create).mock.calls[0]?.[0];
    expect(created).not.toHaveProperty('sellerDisplayName');
    expect(created).not.toHaveProperty('contactValue');
    expect(created).not.toHaveProperty('email');
  });

  it('does not swallow non-duplicate persistence failures', async () => {
    const deps = createDependencies({
      create: vi.fn().mockRejectedValue(new Error('Firestore unavailable')),
    });

    await expect(captureListingEvent(
      { params: { listingId: 'listing-1' }, data: listing },
      deps,
    )).rejects.toThrow('Firestore unavailable');
  });

  it('acknowledges a permanently invalid snapshot without entering the retry loop', async () => {
    const deps = createDependencies();

    await expect(captureListingEvent({
      params: { listingId: 'listing-1' },
      data: { ...listing, listingPrice: '<script>alert(1)</script>' as never },
    }, deps)).resolves.toEqual({
      status: 'invalid',
      reason: expect.stringMatching(/listingPrice/),
    });

    expect(deps.events.create).not.toHaveBeenCalled();
  });
});

describe('reserveDiscordDeliveryAttempt', () => {
  it('never reserves an email-only event with Discord disabled', () => {
    expect(reserveDiscordDeliveryAttempt(
      { ...event, discordStatus: 'disabled' },
      'claim-1',
      now,
      new Date('2026-08-25T02:05:00.000Z'),
      3,
    )).toBeNull();
  });

  it('does not reserve a fourth POST after three claimed attempts crash and expire', () => {
    const firstLease = new Date('2026-08-25T02:05:00.000Z');
    const first = reserveDiscordDeliveryAttempt(
      event,
      'claim-1',
      now,
      firstLease,
      3,
    );
    expect(first).toMatchObject({
      attempts: 1,
      discordClaimId: 'claim-1',
      discordStatus: 'failed',
      discordLeaseUntil: Timestamp.fromDate(firstLease),
      nextAttemptAt: Timestamp.fromDate(firstLease),
    });

    const secondLease = new Date('2026-08-25T02:10:00.000Z');
    const second = reserveDiscordDeliveryAttempt(
      first!,
      'claim-2',
      firstLease,
      secondLease,
      3,
    );
    expect(second).toMatchObject({
      attempts: 2,
      discordClaimId: 'claim-2',
      discordLeaseUntil: Timestamp.fromDate(secondLease),
      nextAttemptAt: Timestamp.fromDate(secondLease),
    });

    const thirdLease = new Date('2026-08-25T02:15:00.000Z');
    const third = reserveDiscordDeliveryAttempt(
      second!,
      'claim-3',
      secondLease,
      thirdLease,
      3,
    );
    expect(third).toMatchObject({
      attempts: 3,
      discordClaimId: 'claim-3',
      discordLeaseUntil: Timestamp.fromDate(thirdLease),
    });
    expect(third).not.toHaveProperty('nextAttemptAt');

    expect(reserveDiscordDeliveryAttempt(
      third!,
      'claim-4',
      thirdLease,
      new Date('2026-08-25T02:20:00.000Z'),
      3,
    )).toBeNull();
  });
});

describe('deliverDiscordEvent', () => {
  it('never publishes an email-only event with Discord disabled', async () => {
    const deps = createDependencies();

    await deliverDiscordEvent({ ...event, discordStatus: 'disabled' }, deps);

    expect(deps.events.claim).not.toHaveBeenCalled();
    expect(deps.discord.publishNewListing).not.toHaveBeenCalled();
  });

  it('posts the approved public Discord event and marks it sent', async () => {
    const deps = createDependencies();

    await deliverDiscordEvent(event, deps);

    expect(deps.discord.publishNewListing).toHaveBeenCalledWith(claimedEvent);
    expect(deps.events.markSent).toHaveBeenCalledWith('listing-1', 'claim-1', now);
  });

  it('marks a Discord failure without changing the Listing', async () => {
    const deps = createDependencies();
    vi.mocked(deps.discord.publishNewListing)
      .mockRejectedValue(new Error('Discord unavailable'));

    await deliverDiscordEvent(event, deps);

    expect(deps.events.markFailed).toHaveBeenCalledWith(
      'listing-1',
      'claim-1',
      1,
      new Date('2026-08-25T02:01:00.000Z'),
    );
    expect(deps.listings.update).not.toHaveBeenCalled();
  });

  it('does not overwrite a successful Discord delivery when saving sent status fails', async () => {
    const deps = createDependencies({
      markSent: vi.fn().mockRejectedValue(new Error('Firestore unavailable')),
    });

    await expect(deliverDiscordEvent(event, deps)).rejects.toThrow('Firestore unavailable');

    expect(deps.discord.publishNewListing).toHaveBeenCalledWith(claimedEvent);
    expect(deps.events.markFailed).not.toHaveBeenCalled();
  });

  it('does not publish an event that is already sent', async () => {
    const deps = createDependencies();

    await deliverDiscordEvent({ ...event, discordStatus: 'sent' }, deps);

    expect(deps.discord.publishNewListing).not.toHaveBeenCalled();
    expect(deps.events.markSent).not.toHaveBeenCalled();
  });

  it('allows only one of two overlapping invocations to publish', async () => {
    const deps = createDependencies({
      claim: vi.fn()
        .mockResolvedValueOnce(claimedEvent)
        .mockResolvedValueOnce(null),
    });
    deps.createClaimId
      .mockReturnValueOnce('claim-1')
      .mockReturnValueOnce('claim-2');

    await Promise.all([
      deliverDiscordEvent(event, deps),
      deliverDiscordEvent(event, deps),
    ]);

    expect(deps.discord.publishNewListing).toHaveBeenCalledTimes(1);
    expect(deps.events.markSent).toHaveBeenCalledTimes(1);
    expect(deps.events.markSent).toHaveBeenCalledWith('listing-1', 'claim-1', now);
  });

  it('stops after three failed claims and leaves the terminal failure unscheduled', async () => {
    const deps = createDependencies({
      claim: vi.fn()
        .mockResolvedValueOnce(claimedEvent)
        .mockResolvedValueOnce({ ...claimedEvent, discordClaimId: 'claim-2', attempts: 2 })
        .mockResolvedValueOnce({
          ...claimedEvent,
          discordClaimId: 'claim-3',
          attempts: 3,
          nextAttemptAt: undefined,
        })
        .mockResolvedValueOnce(null),
    });
    deps.createClaimId
      .mockReturnValueOnce('claim-1')
      .mockReturnValueOnce('claim-2')
      .mockReturnValueOnce('claim-3')
      .mockReturnValueOnce('claim-4');
    vi.mocked(deps.discord.publishNewListing)
      .mockRejectedValue(new Error('Discord unavailable'));

    await deliverDiscordEvent(event, deps);
    await deliverDiscordEvent(event, deps);
    await deliverDiscordEvent(event, deps);
    await deliverDiscordEvent(event, deps);

    expect(deps.discord.publishNewListing).toHaveBeenCalledTimes(3);
    expect(deps.events.markFailed).toHaveBeenNthCalledWith(
      1,
      'listing-1',
      'claim-1',
      1,
      new Date('2026-08-25T02:01:00.000Z'),
    );
    expect(deps.events.markFailed).toHaveBeenNthCalledWith(
      2,
      'listing-1',
      'claim-2',
      2,
      new Date('2026-08-25T02:02:00.000Z'),
    );
    expect(deps.events.markFailed).toHaveBeenNthCalledWith(
      3,
      'listing-1',
      'claim-3',
      3,
      undefined,
    );
  });
});

describe('retryFailedDiscordEvents', () => {
  it('retries due failed events and marks a successful retry sent', async () => {
    const failedEvent: ListingEvent = {
      ...event,
      discordStatus: 'failed',
      attempts: 1,
      nextAttemptAt: Timestamp.fromDate(new Date('2026-08-25T01:59:00.000Z')),
    };
    const deps = createDependencies({
      findDueFailed: vi.fn().mockResolvedValue([failedEvent]),
      claim: vi.fn().mockResolvedValue({
        ...failedEvent,
        discordClaimId: 'claim-1',
        discordLeaseUntil: Timestamp.fromDate(new Date('2026-08-25T02:05:00.000Z')),
        attempts: 2,
        nextAttemptAt: Timestamp.fromDate(new Date('2026-08-25T02:05:00.000Z')),
      }),
    });

    await retryFailedDiscordEvents(now, deps);

    expect(deps.events.findDueFailed).toHaveBeenCalledWith(now, 3, 50);
    expect(deps.discord.publishNewListing).toHaveBeenCalledWith({
      ...failedEvent,
      discordClaimId: 'claim-1',
      discordLeaseUntil: Timestamp.fromDate(new Date('2026-08-25T02:05:00.000Z')),
      attempts: 2,
      nextAttemptAt: Timestamp.fromDate(new Date('2026-08-25T02:05:00.000Z')),
    });
    expect(deps.events.markSent).toHaveBeenCalledWith('listing-1', 'claim-1', now);
    expect(deps.listings.update).not.toHaveBeenCalled();
  });

  it('reconciles bounded shares of pending and failed events', async () => {
    const pendingEvent = { ...event, id: 'listing-pending', listingId: 'listing-pending' };
    const failedEvent: ListingEvent = {
      ...event,
      id: 'listing-failed',
      listingId: 'listing-failed',
      discordStatus: 'failed',
      attempts: 1,
      nextAttemptAt: Timestamp.fromDate(new Date('2026-08-25T01:59:00.000Z')),
    };
    const deps = createDependencies({
      findDueFailed: vi.fn().mockResolvedValue([failedEvent]),
      claim: vi.fn(async (listingId) => ({
        ...(listingId === pendingEvent.listingId ? pendingEvent : failedEvent),
        discordStatus: 'failed',
        discordClaimId: 'claim-1',
        discordLeaseUntil: Timestamp.fromDate(new Date('2026-08-25T02:05:00.000Z')),
        attempts: listingId === pendingEvent.listingId ? 1 : 2,
      })),
    });
    const findPending = vi.fn().mockResolvedValue([pendingEvent]);
    (deps.events as ListingEventStore & {
      findPending(limit: number): Promise<ListingEvent[]>;
    }).findPending = findPending;

    await retryFailedDiscordEvents(now, deps);

    expect(findPending).toHaveBeenCalledWith(50);
    expect(deps.events.findDueFailed).toHaveBeenCalledWith(now, 3, 50);
    expect(deps.discord.publishNewListing).toHaveBeenCalledTimes(2);
  });
});
