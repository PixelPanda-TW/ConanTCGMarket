import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import {
  DAILY_DIGEST_SCHEDULE_OPTIONS,
  DEFAULT_DAILY_RECIPIENT_CAP,
  runDailyDigest as runDailyDigestData,
  type DailyDigestDependencies,
  type NotificationSubscription,
} from './dailyDigest.js';
import { createDiscordClient, discordListingsWebhookUrl } from './discordClient.js';
import type { ListingEvent, ListingSnapshot } from './domain.js';
import {
  createGmailClient,
  createRecipientDirectory,
  gmailOAuthClientId,
  gmailOAuthClientSecret,
  gmailOAuthRefreshToken,
  gmailSenderAddress,
} from './gmailClient.js';
import {
  captureListingEvent as captureListingEventData,
  deliverDiscordEvent as deliverDiscordEventData,
  reserveDiscordDeliveryAttempt,
  retryFailedDiscordEvents as retryFailedDiscordEventsData,
  type ListingEventDependencies,
  type ListingEventStore,
} from './listingEvents.js';

if (getApps().length === 0) {
  initializeApp();
}

const firestore = getFirestore();

const eventStore: ListingEventStore = {
  async create(event) {
    await firestore.collection('listingEvents').doc(event.id).create(event);
  },
  async claim(listingId, claimId, claimedAt, leaseUntil, maxAttempts) {
    const eventReference = firestore.collection('listingEvents').doc(listingId);

    return firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(eventReference);
      if (!snapshot.exists) {
        return null;
      }

      const claimed = reserveDiscordDeliveryAttempt(
        snapshot.data() as ListingEvent,
        claimId,
        claimedAt,
        leaseUntil,
        maxAttempts,
      );
      if (!claimed) {
        return null;
      }

      transaction.set(eventReference, claimed);
      return claimed;
    });
  },
  async markSent(listingId, claimId, sentAt) {
    const eventReference = firestore.collection('listingEvents').doc(listingId);

    await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(eventReference);
      if (!snapshot.exists) {
        return;
      }

      const current = snapshot.data() as ListingEvent;
      if (current.discordStatus === 'sent' || current.discordClaimId !== claimId) {
        return;
      }

      transaction.update(eventReference, {
        discordStatus: 'sent',
        discordSentAt: Timestamp.fromDate(sentAt),
        discordClaimId: FieldValue.delete(),
        discordLeaseUntil: FieldValue.delete(),
        nextAttemptAt: FieldValue.delete(),
      });
    });
  },
  async markFailed(listingId, claimId, attempts, nextAttemptAt) {
    const eventReference = firestore.collection('listingEvents').doc(listingId);

    await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(eventReference);
      if (!snapshot.exists) {
        return;
      }

      const current = snapshot.data() as ListingEvent;
      if (current.discordStatus === 'sent' || current.discordClaimId !== claimId) {
        return;
      }

      transaction.update(eventReference, {
        discordStatus: 'failed',
        attempts,
        discordClaimId: FieldValue.delete(),
        discordLeaseUntil: FieldValue.delete(),
        nextAttemptAt: nextAttemptAt
          ? Timestamp.fromDate(nextAttemptAt)
          : FieldValue.delete(),
      });
    });
  },
  async findDueFailed(now, maxAttempts) {
    const snapshot = await firestore.collection('listingEvents')
      .where('discordStatus', '==', 'failed')
      .where('attempts', '<', maxAttempts)
      .where('nextAttemptAt', '<=', Timestamp.fromDate(now))
      .get();

    return snapshot.docs.map((document) => document.data() as ListingEvent);
  },
};

const dependencies: ListingEventDependencies = {
  events: eventStore,
  discord: createDiscordClient(),
  now: () => new Date(),
  createClaimId: randomUUID,
};

const dailyDigestDependencies: DailyDigestDependencies = {
  subscriptions: {
    async listEmailDailyEnabled() {
      const snapshot = await firestore.collection('notificationSubscriptions')
        .where('emailDailyEnabled', '==', true)
        .limit(DEFAULT_DAILY_RECIPIENT_CAP)
        .get();

      return snapshot.docs.map((document): NotificationSubscription => {
        const data = document.data();
        return {
          uid: document.id,
          characterKeys: data.characterKeys as string[],
          emailDailyEnabled: data.emailDailyEnabled as boolean,
          updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : new Date(0),
        };
      });
    },
  },
  events: {
    async findNewByCharacterKeys(characterKeys, after, through) {
      if (characterKeys.length === 0 || characterKeys.length > 30) {
        throw new Error('Daily digest character query requires between 1 and 30 keys.');
      }

      const snapshot = await firestore.collection('listingEvents')
        .where('characterKey', 'in', characterKeys)
        .where('createdAt', '>', Timestamp.fromDate(after))
        .where('createdAt', '<=', Timestamp.fromDate(through))
        .orderBy('createdAt', 'asc')
        .get();

      return snapshot.docs.map((document) => document.data() as ListingEvent);
    },
  },
  deliveryState: {
    async getCursor(uid) {
      const snapshot = await firestore.collection('notificationDeliveryState').doc(uid).get();
      const cursor = snapshot.data()?.emailDailyCursor;
      return cursor instanceof Timestamp ? cursor.toDate() : null;
    },
    async advance(uid, cursor) {
      await firestore.collection('notificationDeliveryState').doc(uid).set({
        emailDailyCursor: Timestamp.fromDate(cursor),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    },
  },
  recipients: createRecipientDirectory(),
  gmail: createGmailClient(),
  recipientCap: DEFAULT_DAILY_RECIPIENT_CAP,
};

export const captureListingEvent = onDocumentCreated(
  'listings/{listingId}',
  async (source) => {
    if (!source.data) {
      return;
    }

    await captureListingEventData({
      params: { listingId: source.params.listingId },
      data: source.data.data() as ListingSnapshot,
    }, dependencies);
  },
);

export const deliverDiscordEvent = onDocumentCreated(
  {
    document: 'listingEvents/{listingId}',
    secrets: [discordListingsWebhookUrl],
  },
  async (source) => {
    if (!source.data) {
      return;
    }

    const current = await source.data.ref.get();
    if (!current.exists) {
      return;
    }

    await deliverDiscordEventData(current.data() as ListingEvent, dependencies);
  },
);

export const retryFailedDiscordEvents = onSchedule(
  {
    schedule: 'every 15 minutes',
    secrets: [discordListingsWebhookUrl],
  },
  async () => retryFailedDiscordEventsData(new Date(), dependencies),
);

export const sendDailyDigest = onSchedule(
  {
    ...DAILY_DIGEST_SCHEDULE_OPTIONS,
    secrets: [
      gmailOAuthClientId,
      gmailOAuthClientSecret,
      gmailOAuthRefreshToken,
      gmailSenderAddress,
    ],
  },
  async () => runDailyDigestData(new Date(), dailyDigestDependencies),
);
