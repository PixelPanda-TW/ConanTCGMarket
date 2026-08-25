import { toListingEvent, type DiscordClient, type ListingEvent, type ListingSnapshot } from './domain.js';

const MAX_DISCORD_ATTEMPTS = 3;
const INITIAL_RETRY_DELAY_MS = 60_000;
const DELIVERY_LEASE_MS = 5 * 60_000;

export interface ListingEventStore {
  create(event: ListingEvent): Promise<void>;
  claim(
    listingId: string,
    claimId: string,
    claimedAt: Date,
    leaseUntil: Date,
    maxAttempts: number,
  ): Promise<ListingEvent | null>;
  markSent(listingId: string, claimId: string, sentAt: Date): Promise<void>;
  markFailed(
    listingId: string,
    claimId: string,
    attempts: number,
    nextAttemptAt: Date | undefined,
  ): Promise<void>;
  findDueFailed(now: Date, maxAttempts: number): Promise<ListingEvent[]>;
}

export interface ListingEventDependencies {
  events: ListingEventStore;
  discord: DiscordClient;
  now(): Date;
  createClaimId(): string;
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

function nextAttemptAt(now: Date, attempts: number): Date | undefined {
  if (attempts >= MAX_DISCORD_ATTEMPTS) {
    return undefined;
  }

  const delay = INITIAL_RETRY_DELAY_MS * (2 ** (attempts - 1));
  return new Date(now.getTime() + delay);
}

export async function deliverDiscordEvent(
  event: ListingEvent,
  deps: ListingEventDependencies,
): Promise<void> {
  if (event.discordStatus === 'sent' || event.attempts >= MAX_DISCORD_ATTEMPTS) {
    return;
  }

  const attemptedAt = deps.now();
  const claimId = deps.createClaimId();
  const claimedEvent = await deps.events.claim(
    event.listingId,
    claimId,
    attemptedAt,
    new Date(attemptedAt.getTime() + DELIVERY_LEASE_MS),
    MAX_DISCORD_ATTEMPTS,
  );

  if (!claimedEvent) {
    return;
  }

  try {
    await deps.discord.publishNewListing(claimedEvent);
  } catch {
    const attempts = claimedEvent.attempts + 1;
    await deps.events.markFailed(
      claimedEvent.listingId,
      claimId,
      attempts,
      nextAttemptAt(attemptedAt, attempts),
    );
    return;
  }

  await deps.events.markSent(claimedEvent.listingId, claimId, attemptedAt);
}

export async function retryFailedDiscordEvents(
  now: Date,
  deps: ListingEventDependencies,
): Promise<void> {
  const dueEvents = await deps.events.findDueFailed(now, MAX_DISCORD_ATTEMPTS);

  for (const event of dueEvents) {
    await deliverDiscordEvent(event, deps);
  }
}
