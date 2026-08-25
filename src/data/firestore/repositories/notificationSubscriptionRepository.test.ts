import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  doc: vi.fn(),
  getDoc: vi.fn(),
  getFirestore: vi.fn(() => ({ type: 'firestore' })),
  setDoc: vi.fn(),
  deleteDoc: vi.fn(),
}));
const firebaseApp = vi.hoisted(() => ({
  firebaseApp: { name: 'test-app' },
  auth: { currentUser: { uid: 'buyer-1' as string | null } },
}));

vi.mock('firebase/firestore', () => firestore);
vi.mock('../../../lib/firebase/app', () => firebaseApp);

import {
  deleteNotificationSubscription,
  getNotificationSubscription,
  saveNotificationSubscription,
} from './notificationSubscriptionRepository';
import { notificationSubscriptionConverter } from '../converters';
import { collections } from '../paths';
import type { NotificationSubscription } from '../../../domain/models';

describe('notification subscription repository', () => {
  const convertedDocument = { type: 'converted-notification-subscription' };
  const withConverter = vi.fn(() => convertedDocument);
  const subscription: NotificationSubscription = {
    uid: 'buyer-1',
    characterKeys: ['suzuki-sonoko'],
    emailDailyEnabled: true,
    updatedAt: new Date('2026-08-25T00:00:00.000Z'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    firestore.doc.mockReturnValue({ withConverter });
    firebaseApp.auth.currentUser = { uid: 'buyer-1' };
  });

  it('writes only the authenticated buyer subscription document', async () => {
    await saveNotificationSubscription(subscription);

    expect(firestore.setDoc).toHaveBeenCalledWith(convertedDocument, subscription);
    expect(firestore.doc).toHaveBeenCalledWith(
      expect.anything(),
      collections.notificationSubscriptions,
      'buyer-1',
    );
    expect(withConverter).toHaveBeenCalledWith(notificationSubscriptionConverter);
  });

  it('gets the authenticated buyer subscription document', async () => {
    firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => subscription });

    await expect(getNotificationSubscription('buyer-1')).resolves.toEqual(subscription);
  });

  it('returns null when the authenticated buyer has no subscription document', async () => {
    firestore.getDoc.mockResolvedValue({ exists: () => false });

    await expect(getNotificationSubscription('buyer-1')).resolves.toBeNull();
  });

  it('deletes the authenticated buyer subscription document', async () => {
    await deleteNotificationSubscription('buyer-1');

    expect(firestore.deleteDoc).toHaveBeenCalledWith(convertedDocument);
  });

  it('rejects another buyer before reading, writing, or deleting', async () => {
    firebaseApp.auth.currentUser = { uid: 'buyer-2' };

    await expect(getNotificationSubscription('buyer-1')).rejects.toThrow(
      'Notification subscription access requires the authenticated buyer.',
    );
    await expect(saveNotificationSubscription(subscription)).rejects.toThrow(
      'Notification subscription access requires the authenticated buyer.',
    );
    await expect(deleteNotificationSubscription('buyer-1')).rejects.toThrow(
      'Notification subscription access requires the authenticated buyer.',
    );
    expect(firestore.getDoc).not.toHaveBeenCalled();
    expect(firestore.setDoc).not.toHaveBeenCalled();
    expect(firestore.deleteDoc).not.toHaveBeenCalled();
  });
});
