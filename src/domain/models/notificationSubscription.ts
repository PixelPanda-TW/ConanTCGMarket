const MAX_NOTIFICATION_CARD_NAMES = 100;
const MAX_NOTIFICATION_CARD_NAME_LENGTH = 100;

export interface NotificationSubscription {
  uid: string;
  cardNames: string[];
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

  if (!Array.isArray(subscription.cardNames)) {
    throw new Error('Notification subscription requires cardNames.');
  }
  if (subscription.cardNames.length > MAX_NOTIFICATION_CARD_NAMES) {
    throw new Error('Notification subscription allows at most 100 card names.');
  }

  const cardNames = new Set<string>();
  for (const cardName of subscription.cardNames) {
    if (typeof cardName !== 'string' || cardName.length === 0) {
      throw new Error('Notification subscription requires non-empty card names.');
    }
    if (cardName !== cardName.trim()) {
      throw new Error('Notification subscription requires trimmed card names.');
    }
    if (cardName.length > MAX_NOTIFICATION_CARD_NAME_LENGTH) {
      throw new Error('Notification card names must contain at most 100 characters.');
    }

    if (cardNames.has(cardName)) {
      throw new Error('Notification subscription requires unique card names.');
    }

    cardNames.add(cardName);
  }

  if (typeof subscription.emailDailyEnabled !== 'boolean') {
    throw new Error('Notification subscription requires a boolean emailDailyEnabled preference.');
  }

  if (!(subscription.updatedAt instanceof Date) || Number.isNaN(subscription.updatedAt.valueOf())) {
    throw new Error('Notification subscription requires a valid updatedAt date.');
  }
}
