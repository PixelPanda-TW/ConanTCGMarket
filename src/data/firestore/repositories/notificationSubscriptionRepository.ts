import { deleteDoc, doc, getDoc, runTransaction } from 'firebase/firestore';
import {
  validateNotificationSubscription,
  type NotificationSubscription,
} from '../../../domain/models';
import { auth } from '../../../lib/firebase/app';
import {
  notificationSubscriptionConverter,
  readNotificationSubscriptionDocument,
} from '../converters';
import { firestoreDb } from '../database';
import { collections } from '../paths';

const notificationSubscriptionDocument = (uid: string) =>
  doc(firestoreDb, collections.notificationSubscriptions, uid);

function assertOwner(uid: string) {
  if (auth.currentUser?.uid !== uid) {
    throw new Error('Notification subscription access requires the authenticated buyer.');
  }
}

export async function getNotificationSubscription(uid: string): Promise<NotificationSubscription | null> {
  assertOwner(uid);
  const snapshot = await getDoc(notificationSubscriptionDocument(uid));
  return snapshot.exists()
    ? readNotificationSubscriptionDocument(uid, snapshot.data())
    : null;
}

function validateMutationCardName(uid: string, cardName: string) {
  validateNotificationSubscription({
    uid,
    cardNames: [cardName],
    sellerSubscriptions: [],
    emailDailyEnabled: true,
    updatedAt: new Date(),
  });
}

async function mutateNotificationSubscription(
  uid: string,
  mutation: (
    current: NotificationSubscription | null,
  ) => NotificationSubscription | null,
): Promise<NotificationSubscription | null> {
  const reference = notificationSubscriptionDocument(uid);
  return runTransaction(firestoreDb, async (transaction) => {
    const snapshot = await transaction.get(reference);
    const current = snapshot.exists()
      ? readNotificationSubscriptionDocument(uid, snapshot.data())
      : null;
    const next = mutation(current);
    if (!next) return null;

    validateNotificationSubscription(next);
    transaction.set(reference, notificationSubscriptionConverter.toFirestore(next));
    return next;
  });
}

export async function addNotificationCardName(
  uid: string,
  cardName: string,
): Promise<NotificationSubscription> {
  assertOwner(uid);
  validateMutationCardName(uid, cardName);
  const saved = await mutateNotificationSubscription(uid, (current) => ({
    uid,
    cardNames: current?.cardNames.includes(cardName)
      ? [...current.cardNames]
      : [...(current?.cardNames ?? []), cardName],
    sellerSubscriptions: [...(current?.sellerSubscriptions ?? [])],
    emailDailyEnabled: true,
    updatedAt: new Date(),
  }));
  return saved!;
}

export async function removeNotificationCardName(
  uid: string,
  cardName: string,
): Promise<NotificationSubscription | null> {
  assertOwner(uid);
  validateMutationCardName(uid, cardName);
  return mutateNotificationSubscription(uid, (current) => {
    if (!current || !current.cardNames.includes(cardName)) return current;
    return {
      ...current,
      cardNames: current.cardNames.filter((name) => name !== cardName),
      updatedAt: new Date(),
    };
  });
}

export async function setNotificationEmailDailyEnabled(
  uid: string,
  emailDailyEnabled: boolean,
): Promise<NotificationSubscription> {
  assertOwner(uid);
  const saved = await mutateNotificationSubscription(uid, (current) => ({
    uid,
    cardNames: [...(current?.cardNames ?? [])],
    sellerSubscriptions: [...(current?.sellerSubscriptions ?? [])],
    emailDailyEnabled,
    updatedAt: new Date(),
  }));
  return saved!;
}

export async function deleteNotificationSubscription(uid: string): Promise<void> {
  assertOwner(uid);
  await deleteDoc(notificationSubscriptionDocument(uid));
}
