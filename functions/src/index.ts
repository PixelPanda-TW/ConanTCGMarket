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
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
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
import { readListingEventPage } from './domain.js';
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
import {
  ListingLifecycleError,
  handleDeleteUnsoldListing,
  handleRecordListingSale,
  handleUpdateSellerListing,
  type ListingLifecycleDependencies,
  type ListingLifecycleTransaction,
  type ListingMutation,
} from './listingLifecycle.js';
import {
  SecureSellerProfileError,
  handleGetOwnSellerProfile,
  handleGetSellerContact,
  handleSaveSellerProfile,
  type ContactAccessAudit,
  type SecureSellerProfileDependencies,
  type SecureSellerProfileTransaction,
} from './sellerProfiles.js';

if (getApps().length === 0) {
  initializeApp();
}

const firestore = getFirestore();

function firestoreDataWithDates(data: DocumentData | undefined): Record<string, unknown> | null {
  if (!data) return null;
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [
    key,
    value instanceof Timestamp ? value.toDate() : value,
  ]));
}

function storedAudit(audit: ContactAccessAudit): DocumentData {
  return {
    requesterUid: audit.requesterUid,
    ...(audit.sellerUid ? { sellerUid: audit.sellerUid } : {}),
    listingId: audit.listingId,
    outcome: audit.outcome,
    createdAt: Timestamp.fromDate(audit.createdAt),
  };
}

const secureSellerProfileDependencies: SecureSellerProfileDependencies = {
  now: () => new Date(),
  randomId: randomUUID,
  async runTransaction(operation) {
    return firestore.runTransaction(async (transaction) => {
      const port: SecureSellerProfileTransaction = {
        async getAccountAccess(uid) {
          const snapshot = await transaction.get(firestore.collection('accountAccess').doc(uid));
          return snapshot.exists ? firestoreDataWithDates(snapshot.data()) : null;
        },
        async getPublicProfile(uid) {
          const snapshot = await transaction.get(firestore.collection('sellerProfiles').doc(uid));
          return snapshot.exists ? firestoreDataWithDates(snapshot.data()) : null;
        },
        async getSellerContact(uid) {
          const snapshot = await transaction.get(firestore.collection('sellerContacts').doc(uid));
          return snapshot.exists ? firestoreDataWithDates(snapshot.data()) : null;
        },
        async getListing(id) {
          const snapshot = await transaction.get(firestore.collection('listings').doc(id));
          return snapshot.exists ? firestoreDataWithDates(snapshot.data()) : null;
        },
        async getRequesterCount(key) {
          const snapshot = await transaction.get(
            firestore.collection('sellerContactRequesterLimits').doc(key),
          );
          return snapshot.exists ? snapshot.data()?.count as number : 0;
        },
        async getSellerCount(key) {
          const snapshot = await transaction.get(
            firestore.collection('sellerContactSellerLimits').doc(key),
          );
          return snapshot.exists ? snapshot.data()?.count as number : 0;
        },
        saveProfilePair(uid, profile, contact) {
          transaction.set(firestore.collection('sellerProfiles').doc(uid), {
            displayName: profile.displayName,
            createdAt: Timestamp.fromDate(profile.createdAt),
            updatedAt: Timestamp.fromDate(profile.updatedAt),
          });
          transaction.set(firestore.collection('sellerContacts').doc(uid), {
            contactType: contact.contactType,
            contactValue: contact.contactValue,
            createdAt: Timestamp.fromDate(contact.createdAt),
            updatedAt: Timestamp.fromDate(contact.updatedAt),
          });
        },
        setRequesterCount(key, count) {
          transaction.set(firestore.collection('sellerContactRequesterLimits').doc(key), {
            count,
            updatedAt: FieldValue.serverTimestamp(),
          });
        },
        setSellerCount(key, count) {
          transaction.set(firestore.collection('sellerContactSellerLimits').doc(key), {
            count,
            updatedAt: FieldValue.serverTimestamp(),
          });
        },
        createAudit(audit) {
          transaction.create(
            firestore.collection('sellerContactAccessLogs').doc(audit.id),
            storedAudit(audit),
          );
        },
      };
      return operation(port);
    });
  },
  async writeAudit(audit) {
    await firestore.collection('sellerContactAccessLogs').doc(audit.id).create(storedAudit(audit));
  },
};

function throwCallableError(error: unknown, operation: string): never {
  if (error instanceof SecureSellerProfileError || error instanceof ListingLifecycleError) {
    throw new HttpsError(error.code, error.message);
  }
  logError(`${operation} failed.`, error);
  throw new HttpsError('unavailable', '服務目前無法使用，請稍後再試。');
}

export const saveSellerProfile = onCall(async (request) => {
  try {
    return await handleSaveSellerProfile({
      authUid: request.auth?.uid ?? null,
      data: request.data,
    }, secureSellerProfileDependencies);
  } catch (error) {
    throwCallableError(error, 'Seller profile save');
  }
});

export const getOwnSellerProfile = onCall(async (request) => {
  try {
    return await handleGetOwnSellerProfile({
      authUid: request.auth?.uid ?? null,
      data: request.data,
    }, secureSellerProfileDependencies);
  } catch (error) {
    throwCallableError(error, 'Own seller profile read');
  }
});

export const getSellerContact = onCall(async (request) => {
  try {
    return await handleGetSellerContact({
      authUid: request.auth?.uid ?? null,
      data: request.data,
    }, secureSellerProfileDependencies);
  } catch (error) {
    throwCallableError(error, 'Seller contact disclosure');
  }
});

function storedListingMutation(patch: ListingMutation): DocumentData {
  return Object.fromEntries(Object.entries(patch).map(([key, value]) => [
    key,
    value === null ? FieldValue.delete() : value instanceof Date ? Timestamp.fromDate(value) : value,
  ]));
}

const listingLifecycleDependencies: ListingLifecycleDependencies = {
  now: () => new Date(),
  randomId: randomUUID,
  async runTransaction(operation) {
    return firestore.runTransaction(async (transaction) => {
      const port: ListingLifecycleTransaction = {
        async getAccountAccess(uid) {
          const snapshot = await transaction.get(firestore.collection('accountAccess').doc(uid));
          return snapshot.exists ? firestoreDataWithDates(snapshot.data()) : null;
        },
        async getListing(id) {
          const snapshot = await transaction.get(firestore.collection('listings').doc(id));
          return snapshot.exists ? firestoreDataWithDates(snapshot.data()) : null;
        },
        async hasSaleForListing(id) {
          const saleQuery = firestore.collection('sales').where('listingId', '==', id).limit(1);
          return !(await transaction.get(saleQuery)).empty;
        },
        createSale(id, sale) {
          transaction.create(firestore.collection('sales').doc(id), {
            ...sale,
            soldAt: Timestamp.fromDate(sale.soldAt),
          });
        },
        updateListing(id, patch) {
          transaction.update(
            firestore.collection('listings').doc(id),
            storedListingMutation(patch),
          );
        },
        deleteListing(id) {
          transaction.delete(firestore.collection('listings').doc(id));
        },
      };
      return operation(port);
    });
  },
};

export const recordListingSale = onCall(async (request) => {
  try {
    return await handleRecordListingSale({
      authUid: request.auth?.uid ?? null,
      data: request.data,
    }, listingLifecycleDependencies);
  } catch (error) {
    throwCallableError(error, 'Listing sale');
  }
});

export const updateSellerListing = onCall(async (request) => {
  try {
    return await handleUpdateSellerListing({
      authUid: request.auth?.uid ?? null,
      data: request.data,
    }, listingLifecycleDependencies);
  } catch (error) {
    throwCallableError(error, 'Listing update');
  }
});

export const deleteUnsoldListing = onCall(async (request) => {
  try {
    return await handleDeleteUnsoldListing({
      authUid: request.auth?.uid ?? null,
      data: request.data,
    }, listingLifecycleDependencies);
  } catch (error) {
    throwCallableError(error, 'Listing deletion');
  }
});

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

      return readListingEventPage(
        snapshot.docs.map((document) => document.data()),
        afterSequence,
        limit,
      );
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
