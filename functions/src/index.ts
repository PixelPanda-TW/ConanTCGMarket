import { getApps, initializeApp } from 'firebase-admin/app';
import {
  FieldPath,
  FieldValue,
  Timestamp,
  getFirestore,
  type DocumentData,
} from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { error as logError } from 'firebase-functions/logger';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import {
  DAILY_DIGEST_SCHEDULE_OPTIONS,
  DEFAULT_DAILY_RECIPIENT_CAP,
  beginDailyDigestSend,
  completeDailyDigestDelivery,
  completeDailyDigestWithoutSend,
  isDailyDigestReservedClaimStale,
  recoverDailyDigestDelivery,
  releaseDailyDigestDelivery,
  reserveDailyDigestDelivery,
  runDailyDigest as runDailyDigestData,
  type DailyDigestDependencies,
  type DailyDigestDeliveryRecord,
  type NotificationSubscription,
} from './dailyDigest.js';
import {
  DailyDigestOperatorError,
  handleDailyDigestOperatorRequest,
  type DailyDigestOperatorDependencies,
} from './dailyDigestOperator.js';
import type { ListingEvent } from './domain.js';
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
  type ListingEventStore,
} from './listingEvents.js';

if (getApps().length === 0) {
  initializeApp();
}

const firestore = getFirestore();

function readDailyDeliveryRecord(data: DocumentData | undefined): DailyDigestDeliveryRecord {
  const cursorSequence = data?.emailDailyCursorSequence;
  const windowEndSequence = data?.emailDailyWindowEndSequence;
  const claimId = typeof data?.emailDailyClaimId === 'string'
    ? data.emailDailyClaimId as string
    : undefined;
  const storedClaimState = data?.emailDailyClaimState;
  const claimRunDate = typeof data?.emailDailyClaimRunDate === 'string'
    ? data.emailDailyClaimRunDate as string
    : undefined;
  const completedRunDate = typeof data?.emailDailyCompletedRunDate === 'string'
    ? data.emailDailyCompletedRunDate as string
    : undefined;
  return {
    ...(Number.isSafeInteger(cursorSequence) && cursorSequence >= 0
      ? { cursorSequence: cursorSequence as number }
      : {}),
    ...(claimId
      ? {
        claimId,
        claimState: storedClaimState === 'reserved' || storedClaimState === 'sending'
          ? storedClaimState
          : 'sending',
      }
      : {}),
    ...(claimRunDate ? { claimRunDate } : {}),
    ...(completedRunDate ? { completedRunDate } : {}),
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
    ...(record.claimState ? { emailDailyClaimState: record.claimState } : {}),
    ...(record.claimRunDate ? { emailDailyClaimRunDate: record.claimRunDate } : {}),
    ...(record.completedRunDate
      ? { emailDailyCompletedRunDate: record.completedRunDate }
      : {}),
    ...(record.reservedAt ? { emailDailyReservedAt: record.reservedAt } : {}),
    ...(record.windowEndSequence !== undefined
      ? { emailDailyWindowEndSequence: record.windowEndSequence }
      : {}),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

const eventStore: Pick<ListingEventStore, 'create'> = {
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
          cardNames: data.cardNames as string[],
          emailDailyEnabled: data.emailDailyEnabled as boolean,
          updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : new Date(0),
        };
      });
    },
  },
  events: {
    async findNewInSequenceRange(afterSequence, throughSequence, limit) {
      const snapshot = await firestore.collection('listingEvents')
        .where('capturedSequence', '>', afterSequence)
        .where('capturedSequence', '<=', throughSequence)
        .orderBy('capturedSequence', 'asc')
        .limit(limit)
        .get();

      return snapshot.docs.map((document) => document.data() as ListingEvent);
    },
  },
  deliveryState: {
    async claim(uid, claimId, reservedAt, windowEndSequence, runDate) {
      const reference = firestore.collection('notificationDeliveryState').doc(uid);

      return firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        const current = readDailyDeliveryRecord(snapshot.data());
        const claimed = reserveDailyDigestDelivery(
          current,
          claimId,
          reservedAt,
          windowEndSequence,
          runDate,
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
    async completeWithoutSend(uid, claimId) {
      const reference = firestore.collection('notificationDeliveryState').doc(uid);

      await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        const current = readDailyDeliveryRecord(snapshot.data());
        const completed = completeDailyDigestWithoutSend(current, claimId);
        if (!completed) {
          return;
        }

        transaction.set(reference, writeDailyDeliveryRecord(completed));
      });
    },
    async beginSend(uid, claimId) {
      const reference = firestore.collection('notificationDeliveryState').doc(uid);

      return firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        const current = readDailyDeliveryRecord(snapshot.data());
        const sending = beginDailyDigestSend(current, claimId);
        if (!sending) {
          return false;
        }

        transaction.set(reference, writeDailyDeliveryRecord(sending));
        return true;
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
  runs: {
    async getOrCreate(runDate) {
      const runReference = firestore.collection('notificationDigestRuns').doc(runDate);
      const sequenceReference = firestore.collection('notificationDigestRuntime')
        .doc('eventSequence');
      return firestore.runTransaction(async (transaction) => {
        const [runSnapshot, sequenceSnapshot] = await transaction.getAll(
          runReference,
          sequenceReference,
        );
        if (runSnapshot.exists) {
          const storedRunDate = runSnapshot.data()?.runDate;
          const windowEndSequence = runSnapshot.data()?.windowEndSequence;
          if (storedRunDate !== runDate
            || !Number.isSafeInteger(windowEndSequence)
            || windowEndSequence < 0) {
            throw new Error(`Daily digest run ${runDate} is invalid.`);
          }
          return { runDate, windowEndSequence: windowEndSequence as number };
        }

        const lastSequence = sequenceSnapshot.data()?.lastSequence;
        const windowEndSequence = Number.isSafeInteger(lastSequence) && lastSequence >= 0
          ? lastSequence as number
          : 0;
        transaction.create(runReference, {
          runDate,
          windowEndSequence,
          createdAt: FieldValue.serverTimestamp(),
        });
        return { runDate, windowEndSequence };
      });
    },
  },
  recipients: createRecipientDirectory(),
  gmail: createGmailClient(),
  recipientCap: DEFAULT_DAILY_RECIPIENT_CAP,
  createClaimId: randomUUID,
};

const dailyDigestOperatorDependencies: DailyDigestOperatorDependencies = {
  async listActiveClaims(limit) {
    const inspectedAt = new Date();
    const snapshot = await firestore.collection('notificationDeliveryState')
      .where('emailDailyClaimState', 'in', ['reserved', 'sending'])
      .limit(limit)
      .get();

    return snapshot.docs.flatMap((document) => {
      const record = readDailyDeliveryRecord(document.data());
      if (!record.claimId
        || (record.claimState !== 'reserved' && record.claimState !== 'sending')) {
        return [];
      }
      return [{
        uid: document.id,
        claimId: record.claimId,
        claimState: record.claimState,
        ...(record.claimRunDate ? { claimRunDate: record.claimRunDate } : {}),
        reservedAt: record.reservedAt?.toDate().toISOString() ?? null,
        staleReserved: isDailyDigestReservedClaimStale(record, inspectedAt),
        ...(record.cursorSequence !== undefined
          ? { cursorSequence: record.cursorSequence }
          : {}),
        ...(record.windowEndSequence !== undefined
          ? { windowEndSequence: record.windowEndSequence }
          : {}),
      }];
    });
  },
  recover: (uid, claimId, mode) => dailyDigestDependencies.deliveryState
    .recover(uid, claimId, mode),
};

export const dailyDigestOperator = onRequest(
  {
    invoker: 'private',
    timeoutSeconds: 30,
  },
  async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'POST is required.' });
      return;
    }

    try {
      const result = await handleDailyDigestOperatorRequest(
        request.body,
        dailyDigestOperatorDependencies,
      );
      response.status(200).json(result);
    } catch (error) {
      if (error instanceof DailyDigestOperatorError) {
        response.status(error.status).json({ error: error.message });
        return;
      }
      logError('Daily digest operator request failed.', error);
      response.status(500).json({ error: 'Operator request failed.' });
    }
  },
);

export const captureListingEvent = onDocumentCreated(
  {
    document: 'listings/{listingId}',
    retry: true,
    timeoutSeconds: 60,
  },
  async (source) => {
    if (!source.data) {
      return;
    }

    const result = await captureListingEventData({
      params: { listingId: source.params.listingId },
      data: source.data.data(),
    }, { events: eventStore }, { discordEnabled: false });
    if (result.status === 'invalid') {
      logError('Listing event capture skipped a permanently invalid snapshot.', {
        listingId: source.params.listingId,
        reason: result.reason,
      });
    }
  },
);

export const sendDailyDigest = onSchedule(
  {
    ...DAILY_DIGEST_SCHEDULE_OPTIONS,
    retryCount: 3,
    minBackoffSeconds: 60,
    maxBackoffSeconds: 300,
    timeoutSeconds: 540,
    secrets: [
      gmailOAuthClientId,
      gmailOAuthClientSecret,
      gmailOAuthRefreshToken,
      gmailSenderAddress,
    ],
  },
  async (event) => runDailyDigestData(
    new Date(event.scheduleTime),
    dailyDigestDependencies,
  ),
);
