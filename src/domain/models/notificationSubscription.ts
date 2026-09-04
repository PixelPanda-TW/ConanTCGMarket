const MAX_NOTIFICATION_CARD_NAMES = 100;
const MAX_NOTIFICATION_CARD_NAME_LENGTH = 100;
const MAX_NOTIFICATION_SELLERS = 100;
const MAX_SELLER_ID_LENGTH = 128;

export interface SellerSubscription {
  sellerId: string;
  followedAt: Date;
}

export interface NotificationSubscription {
  uid: string;
  cardNames: string[];
  sellerSubscriptions: SellerSubscription[];
  emailDailyEnabled: boolean;
  updatedAt: Date;
}

function hasExactFields(value: object, fields: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => keys.includes(field));
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

  if (!Array.isArray(subscription.sellerSubscriptions)
    || subscription.sellerSubscriptions.length > MAX_NOTIFICATION_SELLERS) {
    throw new Error('Notification seller subscriptions require a list of at most 100 entries.');
  }
  let previousSellerId: string | null = null;
  for (const entry of subscription.sellerSubscriptions) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)
      || !hasExactFields(entry, ['sellerId', 'followedAt'])) {
      throw new Error('Notification seller subscriptions require exact entries.');
    }
    if (typeof entry.sellerId !== 'string'
      || entry.sellerId.length < 1
      || entry.sellerId.length > MAX_SELLER_ID_LENGTH
      || entry.sellerId !== entry.sellerId.trim()) {
      throw new Error('Notification seller subscriptions require valid seller IDs.');
    }
    if (!(entry.followedAt instanceof Date) || Number.isNaN(entry.followedAt.valueOf())) {
      throw new Error('Notification seller subscriptions require valid follow dates.');
    }
    if (previousSellerId !== null && previousSellerId >= entry.sellerId) {
      throw new Error('Notification seller subscriptions require unique sorted seller IDs.');
    }
    previousSellerId = entry.sellerId;
  }

  if (typeof subscription.emailDailyEnabled !== 'boolean') {
    throw new Error('Notification subscription requires a boolean emailDailyEnabled preference.');
  }

  if (!(subscription.updatedAt instanceof Date) || Number.isNaN(subscription.updatedAt.valueOf())) {
    throw new Error('Notification subscription requires a valid updatedAt date.');
  }
}
