import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';
import type { NotificationSubscription } from '../../../domain/models';
import { auth } from '../../../lib/firebase/app';
import { notificationSubscriptionConverter } from '../converters';
import { firestoreDb } from '../database';
import { collections } from '../paths';

const notificationSubscriptionDocument = (uid: string) =>
  doc(firestoreDb, collections.notificationSubscriptions, uid).withConverter(notificationSubscriptionConverter);

function assertOwner(uid: string) {
  if (auth.currentUser?.uid !== uid) {
    throw new Error('Notification subscription access requires the authenticated buyer.');
  }
}

export async function getNotificationSubscription(uid: string): Promise<NotificationSubscription | null> {
  assertOwner(uid);
  const snapshot = await getDoc(notificationSubscriptionDocument(uid));
  return snapshot.exists() ? snapshot.data() : null;
}

export async function saveNotificationSubscription(subscription: NotificationSubscription): Promise<void> {
  assertOwner(subscription.uid);
  await setDoc(notificationSubscriptionDocument(subscription.uid), subscription);
}

export async function deleteNotificationSubscription(uid: string): Promise<void> {
  assertOwner(uid);
  await deleteDoc(notificationSubscriptionDocument(uid));
}
