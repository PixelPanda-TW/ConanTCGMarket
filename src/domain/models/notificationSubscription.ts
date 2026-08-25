import { toCharacterKey } from '../characterKey';

const MAX_NOTIFICATION_CHARACTER_KEYS = 100;
const MAX_NOTIFICATION_CHARACTER_KEY_LENGTH = 100;

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
  if (subscription.characterKeys.length > MAX_NOTIFICATION_CHARACTER_KEYS) {
    throw new Error('Notification subscription allows at most 100 character keys.');
  }

  const keys = new Set<string>();
  for (const key of subscription.characterKeys) {
    if (typeof key !== 'string' || key !== toCharacterKey(key)) {
      throw new Error('Notification subscription requires normalized character keys.');
    }
    if (key.length > MAX_NOTIFICATION_CHARACTER_KEY_LENGTH) {
      throw new Error('Notification character keys must contain at most 100 characters.');
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
