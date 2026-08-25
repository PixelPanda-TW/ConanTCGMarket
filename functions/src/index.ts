import { getApps, initializeApp } from 'firebase-admin/app';
import {
  FieldPath,
  FieldValue,
  Timestamp,
  getFirestore,
  type DocumentData,
} from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import {
  DAILY_DIGEST_SCHEDULE_OPTIONS,
  DEFAULT_DAILY_RECIPIENT_CAP,
  completeDailyDigestDelivery,
  recoverDailyDigestDelivery,
  releaseDailyDigestDelivery,
  reserveDailyDigestDelivery,
  runDailyDigest as runDailyDigestData,
  type DailyDigestDependencies,
  type DailyDigestDeliveryRecord,
  type DailyDigestRecoveryMode,
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

function readDailyDeliveryRecord(data: DocumentData | undefined): DailyDigestDeliveryRecord {
  const cursorSequence = data?.emailDailyCursorSequence;
  const windowEndSequence = data?.emailDailyWindowEndSequence;
  return {
    ...(Number.isSafeInteger(cursorSequence) && cursorSequence >= 0
      ? { cursorSequence: cursorSequence as number }
      : {}),
    ...(typeof data?.emailDailyClaimId === 'string'
      ? { claimId: data.emailDailyClaimId }
      : {}),
    ...(data?.emailDailyReservedAt instanceof Timestamp
      ? { reservedAt: data.emailDailyReservedAt }
      : {}),
    ...(Number.isSafeInteger(windowEndSequence) && windowEndSequence >= 0
      ? { windowEndSequence: windowEndSequence as number }
      : {}),
  };
}

function writeDailyDeliveryRecord(record: DailyDigestDeliveryRecord): DocumentData {
  return {
    ...(record.cursorSequence !== undefined
      ? { emailDailyCursorSequence: record.cursorSequence }
      : {}),
    ...(record.claimId ? { emailDailyClaimId: record.claimId } : {}),
    ...(record.reservedAt ? { emailDailyReservedAt: record.reservedAt } : {}),
    ...(record.windowEndSequence !== undefined
      ? { emailDailyWindowEndSequence: record.windowEndSequence }
      : {}),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

const eventStore: ListingEventStore = {
  async create(event) {
    const eventReference = firestore.collection('listingEvents').doc(event.id);
    const sequenceReference = firestore
      .collection('notificationDigestRuntime')
      .doc('eventSequence');

    await firestore.runTransaction(async (transaction) => {
      const sequenceSnapshot = await transaction.get(sequenceReference);
      const storedSequence = sequenceSnapshot.data()?.lastSequence;
      const lastSequence = Number.isSafeInteger(storedSequence) && storedSequence >= 0
        ? storedSequence as number
        : 0;
      const capturedSequence = lastSequence + 1;
      if (!Number.isSafeInteger(capturedSequence)) {
        throw new Error('Listing event sequence is exhausted.');
      }

      transaction.create(eventReference, {
        ...event,
        capturedAt: FieldValue.serverTimestamp(),
        capturedSequence,
      });
      transaction.set(sequenceReference, {
        lastSequence: capturedSequence,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
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
    async listEmailDailyEnabled(afterUid, limit) {
      let query = firestore.collection('notificationSubscriptions')
        .where('emailDailyEnabled', '==', true)
        .orderBy(FieldPath.documentId())
        .limit(limit);
      if (afterUid) {
        query = query.startAfter(afterUid);
      }
      const snapshot = await query.get();

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
    async findNewByCharacterKeys(characterKeys, afterSequence, throughSequence) {
      if (characterKeys.length === 0 || characterKeys.length > 30) {
        throw new Error('Daily digest character query requires between 1 and 30 keys.');
      }

      const snapshot = await firestore.collection('listingEvents')
        .where('characterKey', 'in', characterKeys)
        .where('capturedSequence', '>', afterSequence)
        .where('capturedSequence', '<=', throughSequence)
        .orderBy('capturedSequence', 'asc')
        .get();

      return snapshot.docs.map((document) => document.data() as ListingEvent);
    },
  },
  deliveryState: {
    async claim(uid, claimId, reservedAt, windowEndSequence) {
      const reference = firestore.collection('notificationDeliveryState').doc(uid);

      return firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        const current = readDailyDeliveryRecord(snapshot.data());
        const claimed = reserveDailyDigestDelivery(
          current,
          claimId,
          reservedAt,
          windowEndSequence,
        );
        if (!claimed) {
          return null;
        }

        transaction.set(reference, writeDailyDeliveryRecord(claimed));

        return {
          claimId,
          afterSequence: current.cursorSequence ?? 0,
          throughSequence: claimed.windowEndSequence!,
        };
      });
    },
    async complete(uid, claimId) {
      const reference = firestore.collection('notificationDeliveryState').doc(uid);

      await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        const current = readDailyDeliveryRecord(snapshot.data());
        const completed = completeDailyDigestDelivery(current, claimId);
        if (!completed) {
          return;
        }

        transaction.set(reference, writeDailyDeliveryRecord(completed));
      });
    },
    async release(uid, claimId) {
      const reference = firestore.collection('notificationDeliveryState').doc(uid);

      await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        const current = readDailyDeliveryRecord(snapshot.data());
        const released = releaseDailyDigestDelivery(current, claimId);
        if (!released) {
          return;
        }

        transaction.set(reference, writeDailyDeliveryRecord(released));
      });
    },
    async recover(uid, claimId, mode) {
      const reference = firestore.collection('notificationDeliveryState').doc(uid);

      return firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        const current = readDailyDeliveryRecord(snapshot.data());
        const recovered = recoverDailyDigestDelivery(current, claimId, mode);
        if (!recovered) {
          return false;
        }

        transaction.set(reference, writeDailyDeliveryRecord(recovered));
        return true;
      });
    },
  },
  batchState: {
    async getCursor() {
      const snapshot = await firestore.collection('notificationDigestRuntime').doc('scan').get();
      const cursor = snapshot.data()?.subscriptionCursor;
      return typeof cursor === 'string' ? cursor : null;
    },
    async advance(cursor) {
      await firestore.collection('notificationDigestRuntime').doc('scan').set({
        subscriptionCursor: cursor ?? FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    },
  },
  ingestionWatermarks: {
    async create() {
      const reference = firestore
        .collection('notificationDigestRuntime')
        .doc('eventSequence');
      return firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        const lastSequence = snapshot.data()?.lastSequence;
        return Number.isSafeInteger(lastSequence) && lastSequence >= 0
          ? lastSequence as number
          : 0;
      });
    },
  },
  recipients: createRecipientDirectory(),
  gmail: createGmailClient(),
  recipientCap: DEFAULT_DAILY_RECIPIENT_CAP,
  createClaimId: randomUUID,
};

export async function recoverDailyDigestReservation(
  uid: string,
  claimId: string,
  mode: DailyDigestRecoveryMode,
): Promise<boolean> {
  return dailyDigestDependencies.deliveryState.recover(uid, claimId, mode);
}

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
