import { toCharacterKey } from '../characterKey';

export interface NotificationSubscription {
  uid: string;
  characterKeys: string[];
  emailDailyEnabled: boolean;
  updatedAt: Date;
}

export function validateNotificationSubscription(value: unknown) {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Notification subscription must be an object.');
  }

  const subscription = value as NotificationSubscription;

  if (typeof subscription.uid !== 'string' || subscription.uid.trim().length === 0) {
    throw new Error('Notification subscription requires uid.');
  }

  if (!Array.isArray(subscription.characterKeys)) {
    throw new Error('Notification subscription requires characterKeys.');
  }

  const keys = new Set<string>();
  for (const key of subscription.characterKeys) {
    if (typeof key !== 'string' || key !== toCharacterKey(key)) {
      throw new Error('Notification subscription requires normalized character keys.');
    }

    if (keys.has(key)) {
      throw new Error('Notification subscription requires unique character keys.');
    }

    keys.add(key);
  }

  if (typeof subscription.emailDailyEnabled !== 'boolean') {
    throw new Error('Notification subscription requires a boolean emailDailyEnabled preference.');
  }

  if (!(subscription.updatedAt instanceof Date) || Number.isNaN(subscription.updatedAt.valueOf())) {
    throw new Error('Notification subscription requires a valid updatedAt date.');
  }
}
