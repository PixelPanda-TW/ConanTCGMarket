import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import type { DiscordClient, ListingEvent, ListingSnapshot } from './domain.js';
import {
  captureListingEvent,
  deliverDiscordEvent,
  retryFailedDiscordEvents,
  type ListingEventStore,
} from './listingEvents.js';

const now = new Date('2026-08-25T02:00:00.000Z');

const listing: ListingSnapshot = {
  cardId: 'CT-P01-001',
  characterName: '諸伏景光',
  rarity: 'SR',
  listingPrice: 120,
  remainingQuantity: 2,
  status: 'active',
  createdAt: new Date('2026-08-25T01:00:00.000Z'),
};

const event: ListingEvent = {
  id: 'listing-1',
  listingId: 'listing-1',
  characterKey: '諸伏景光',
  characterName: '諸伏景光',
  rarity: 'SR',
  cardId: 'CT-P01-001',
  listingPrice: 120,
  remainingQuantity: 2,
  createdAt: Timestamp.fromDate(new Date('2026-08-25T01:00:00.000Z')),
  discordStatus: 'pending',
  attempts: 0,
};

function createDependencies(overrides: Partial<ListingEventStore> = {}) {
  const events: ListingEventStore = {
    create: vi.fn().mockResolvedValue(undefined),
    markSent: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    findDueFailed: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
  const discord: DiscordClient = {
    publishNewListing: vi.fn().mockResolvedValue(undefined),
  };
  const listings = {
    update: vi.fn().mockResolvedValue(undefined),
  };

  return { events, discord, listings, now: () => new Date(now) };
}

describe('captureListingEvent', () => {
  it('creates one durable pending event from duplicate Listing-created deliveries', async () => {
    const stored = new Map<string, ListingEvent>();
    let successfulCreates = 0;
    const deps = createDependencies({
      create: vi.fn(async (createdEvent: ListingEvent) => {
        if (stored.has(createdEvent.id)) {
          throw Object.assign(new Error('document already exists'), { code: 6 });
        }
        stored.set(createdEvent.id, createdEvent);
        successfulCreates += 1;
      }),
    });

    await captureListingEvent({ params: { listingId: 'listing-1' }, data: listing }, deps);
    await captureListingEvent({ params: { listingId: 'listing-1' }, data: listing }, deps);

    expect(successfulCreates).toBe(1);
    expect([...stored.values()]).toStrictEqual([event]);
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
});

describe('deliverDiscordEvent', () => {
  it('posts the approved public Discord event and marks it sent', async () => {
    const deps = createDependencies();

    await deliverDiscordEvent(event, deps);

    expect(deps.discord.publishNewListing).toHaveBeenCalledWith(event);
    expect(deps.events.markSent).toHaveBeenCalledWith('listing-1', now);
  });

  it('marks a Discord failure without changing the Listing', async () => {
    const deps = createDependencies();
    vi.mocked(deps.discord.publishNewListing)
      .mockRejectedValue(new Error('Discord unavailable'));

    await deliverDiscordEvent(event, deps);

    expect(deps.events.markFailed).toHaveBeenCalledWith(
      'listing-1',
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

    expect(deps.discord.publishNewListing).toHaveBeenCalledWith(event);
    expect(deps.events.markFailed).not.toHaveBeenCalled();
  });

  it('does not publish an event that is not pending', async () => {
    const deps = createDependencies();

    await deliverDiscordEvent({ ...event, discordStatus: 'sent' }, deps);

    expect(deps.discord.publishNewListing).not.toHaveBeenCalled();
    expect(deps.events.markSent).not.toHaveBeenCalled();
  });

  it('does not exceed three total delivery attempts', async () => {
    const deps = createDependencies();

    await deliverDiscordEvent({ ...event, attempts: 3 }, deps);

    expect(deps.discord.publishNewListing).not.toHaveBeenCalled();
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
    });

    await retryFailedDiscordEvents(now, deps);

    expect(deps.events.findDueFailed).toHaveBeenCalledWith(now, 3);
    expect(deps.discord.publishNewListing).toHaveBeenCalledWith({
      ...failedEvent,
      discordStatus: 'pending',
    });
    expect(deps.events.markSent).toHaveBeenCalledWith('listing-1', now);
    expect(deps.listings.update).not.toHaveBeenCalled();
  });
});
