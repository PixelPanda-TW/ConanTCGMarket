import { toListingEvent, type DiscordClient, type ListingEvent, type ListingSnapshot } from './domain.js';

const MAX_DISCORD_ATTEMPTS = 3;
const INITIAL_RETRY_DELAY_MS = 60_000;

export interface ListingEventStore {
  create(event: ListingEvent): Promise<void>;
  markSent(listingId: string, sentAt: Date): Promise<void>;
  markFailed(listingId: string, attempts: number, nextAttemptAt: Date): Promise<void>;
  findDueFailed(now: Date, maxAttempts: number): Promise<ListingEvent[]>;
}

export interface ListingEventDependencies {
  events: ListingEventStore;
  discord: DiscordClient;
  now(): Date;
}

export interface ListingCreatedEvent {
  params: { listingId: string };
  data: ListingSnapshot;
}

function isAlreadyExists(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const code = 'code' in error ? error.code : undefined;
  return code === 6 || code === '6' || code === 'already-exists';
}

export async function captureListingEvent(
  source: ListingCreatedEvent,
  deps: Pick<ListingEventDependencies, 'events'>,
): Promise<void> {
  const event = toListingEvent(source.params.listingId, source.data);

  try {
    await deps.events.create(event);
  } catch (error) {
    if (!isAlreadyExists(error)) {
      throw error;
    }
  }
}

function nextAttemptAt(now: Date, previousAttempts: number): Date {
  const delay = INITIAL_RETRY_DELAY_MS * (2 ** previousAttempts);
  return new Date(now.getTime() + delay);
}

export async function deliverDiscordEvent(
  event: ListingEvent,
  deps: ListingEventDependencies,
): Promise<void> {
  if (event.discordStatus !== 'pending' || event.attempts >= MAX_DISCORD_ATTEMPTS) {
    return;
  }

  const attemptedAt = deps.now();

  try {
    await deps.discord.publishNewListing(event);
  } catch {
    const attempts = event.attempts + 1;
    await deps.events.markFailed(
      event.listingId,
      attempts,
      nextAttemptAt(attemptedAt, event.attempts),
    );
    return;
  }

  await deps.events.markSent(event.listingId, attemptedAt);
}

export async function retryFailedDiscordEvents(
  now: Date,
  deps: ListingEventDependencies,
): Promise<void> {
  const dueEvents = await deps.events.findDueFailed(now, MAX_DISCORD_ATTEMPTS);

  for (const event of dueEvents) {
    await deliverDiscordEvent({ ...event, discordStatus: 'pending' }, deps);
  }
}
