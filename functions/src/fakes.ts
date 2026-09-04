import { Timestamp } from 'firebase-admin/firestore';
import {
  runDailyDigest,
  type DailyDigestDependencies,
  type NotificationSubscription,
} from './dailyDigest.js';
import type { DigestEmail, ListingEvent } from './domain.js';

interface FakeDigestEvent {
  id: string;
  sellerId?: string;
  cardName: string;
  capturedAt: Date;
}

interface FakeDigestSubscription {
  uid: string;
  cardNames: string[];
  sellerSubscriptions?: Array<{
    sellerId: string;
    followedAt: Date;
  }>;
  emailDailyEnabled: boolean;
  updatedAt: Date;
}

export interface FakeDailyDigestInput {
  subscription: FakeDigestSubscription;
  events: readonly FakeDigestEvent[];
}

export interface FakeDailyDigestResult {
  listingIds: string[];
  messages: DigestEmail[];
}

/** Local-only deterministic harness. It has no network, Admin SDK, or production adapter. */
export async function runFakeDailyDigest(
  input: FakeDailyDigestInput,
): Promise<FakeDailyDigestResult> {
  const subscription: NotificationSubscription = {
    ...input.subscription,
    sellerSubscriptions: input.subscription.sellerSubscriptions?.map((entry) => ({
      sellerId: entry.sellerId,
      followedAt: Timestamp.fromDate(entry.followedAt),
    })),
  };
  const events: ListingEvent[] = input.events.map((event, index) => ({
    id: event.id,
    listingId: event.id,
    ...(event.sellerId === undefined ? {} : { sellerId: event.sellerId }),
    cardType: 'character',
    cardName: event.cardName,
    cardId: '0001',
    rarity: 'R',
    listingPrice: 100,
    remainingQuantity: 1,
    createdAt: Timestamp.fromDate(event.capturedAt),
    capturedAt: Timestamp.fromDate(event.capturedAt),
    capturedSequence: index + 1,
    discordStatus: 'disabled',
    attempts: 0,
  }));
  const messages: DigestEmail[] = [];
  const windowEnd = events.length;
  const deps: DailyDigestDependencies = {
    subscriptions: {
      listEmailDailyEnabled: async (afterUid) => (
        afterUid === null ? [subscription] : []
      ),
    },
    events: {
      findNewInSequenceRange: async (afterSequence, throughSequence) => {
        const page = events.filter((event) => (
          event.capturedSequence > afterSequence
            && event.capturedSequence <= throughSequence
        ));
        return {
          events: page,
          nextAfterSequence: page.at(-1)?.capturedSequence ?? afterSequence,
          hasMore: false,
        };
      },
    },
    deliveryState: {
      claim: async (_uid, claimId) => ({ claimId, afterSequence: 0, throughSequence: windowEnd }),
      beginSend: async () => true,
      complete: async () => undefined,
      completeWithoutSend: async () => undefined,
      release: async () => undefined,
      recover: async () => true,
    },
    batchState: {
      getCursor: async () => null,
      advance: async () => undefined,
    },
    runs: {
      getOrCreate: async (runDate) => ({ runDate, windowEndSequence: windowEnd }),
    },
    recipients: {
      getVerifiedEmail: async () => 'buyer@example.test',
    },
    gmail: {
      sendDigest: async (message) => { messages.push(message); },
    },
    recipientCap: 1,
    createClaimId: () => 'fake-claim',
  };

  await runDailyDigest(
    new Date('2026-08-28T01:00:00.000Z'),
    deps,
    new Date('2026-08-28T01:00:00.000Z'),
  );
  return {
    listingIds: messages.flatMap((message) => (
      message.groups.flatMap((group) => group.listings.map((listing) => listing.listingId))
    )),
    messages,
  };
}
