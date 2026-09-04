import {
  Timestamp,
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
  type SnapshotOptions,
} from 'firebase/firestore';
import {
  validateAccountAccess,
  validateCard,
  validateListing,
  validateNotificationSubscription,
  validatePublicSellerProfile,
  validateSale,
  type Card,
  type AccountAccess,
  type Listing,
  type NotificationSubscription,
  type PublicSellerProfile,
  type Sale,
} from '../../domain/models';
import { normalizeCardId } from '../../domain/cardId';
import { toCharacterKey } from '../../domain/characterKey';

type FirestoreData = Record<string, unknown>;

function readData(snapshot: QueryDocumentSnapshot, options?: SnapshotOptions): FirestoreData {
  return snapshot.data(options);
}

const canonicalCardFields = ['cardId', 'cardName', 'cardType', 'rarities'] as const;

function assertCanonicalCardFields(data: FirestoreData) {
  const fields = Object.keys(data).sort();
  if (
    fields.length !== canonicalCardFields.length
    || fields.some((field, index) => field !== canonicalCardFields[index])
  ) {
    throw new Error('Card Master document requires exactly cardId, cardType, cardName, and rarities.');
  }
}

function timestampToDate(value: unknown, fieldName: string): Date {
  if (!(value instanceof Timestamp)) {
    throw new Error(`Expected Firestore Timestamp for ${fieldName}.`);
  }

  return value.toDate();
}

function dateToTimestamp(value: Date): Timestamp {
  return Timestamp.fromDate(value);
}

const activeAccountAccessFields = [
  'status',
  'confirmedViolationCount',
  'updatedAt',
] as const;
const suspendedAccountAccessFields = [
  ...activeAccountAccessFields,
  'suspensionReason',
  'suspendedAt',
  'suspendedBy',
] as const;

function hasExactAccountAccessFields(data: FirestoreData): boolean {
  const expected = data.status === 'active'
    ? activeAccountAccessFields
    : data.status === 'suspended'
      ? suspendedAccountAccessFields
      : [];
  const keys = Object.keys(data);
  return keys.length === expected.length && expected.every((field) => keys.includes(field));
}

export const accountAccessConverter: FirestoreDataConverter<AccountAccess> = {
  toFirestore(value) {
    const access = value as AccountAccess;
    validateAccountAccess(access);
    const data: FirestoreData = {
      status: access.status,
      confirmedViolationCount: access.confirmedViolationCount,
      updatedAt: dateToTimestamp(access.updatedAt),
    };
    if (access.status === 'suspended') {
      data.suspensionReason = access.suspensionReason;
      data.suspendedAt = dateToTimestamp(access.suspendedAt);
      data.suspendedBy = access.suspendedBy;
    }
    return data;
  },
  fromFirestore(snapshot, options) {
    const data = readData(snapshot, options);
    if (!hasExactAccountAccessFields(data)) {
      throw new Error('Account access document has invalid fields.');
    }

    const common = {
      uid: snapshot.id,
      confirmedViolationCount: data.confirmedViolationCount as number,
      updatedAt: timestampToDate(data.updatedAt, 'updatedAt'),
    };
    const access: AccountAccess = data.status === 'suspended'
      ? {
          ...common,
          status: 'suspended',
          suspensionReason: data.suspensionReason as string,
          suspendedAt: timestampToDate(data.suspendedAt, 'suspendedAt'),
          suspendedBy: data.suspendedBy as string,
        }
      : { ...common, status: 'active' };
    validateAccountAccess(access);
    return access;
  },
};

export const cardConverter: FirestoreDataConverter<Card> = {
  toFirestore(card) {
    const cardData = card as Card;
    validateCard(cardData);
    return {
      cardId: cardData.cardId,
      cardType: cardData.cardType,
      cardName: cardData.cardName,
      rarities: cardData.rarities,
    };
  },
  fromFirestore(snapshot, options) {
    const data = readData(snapshot, options);
    assertCanonicalCardFields(data);
    const card: Card = {
      key: snapshot.id,
      cardId: normalizeCardId(data.cardId as string),
      cardType: data.cardType as Card['cardType'],
      cardName: data.cardName as string,
      rarities: data.rarities as string[],
    };

    validateCard(card);
    return card;
  },
};

export const listingConverter: FirestoreDataConverter<Listing> = {
  toFirestore(listing) {
    const listingData = listing as Listing;
    validateListing(listingData);
    const data: FirestoreData = {
      sellerId: listingData.sellerId,
      cardId: listingData.cardId,
      cardType: listingData.cardType,
      cardName: listingData.cardName,
      rarity: listingData.rarity,
      imageUrls: listingData.imageUrls,
      listingPrice: listingData.listingPrice,
      originalQuantity: listingData.originalQuantity,
      remainingQuantity: listingData.remainingQuantity,
      hasSleeve: listingData.hasSleeve,
      supportsMyShip: listingData.supportsMyShip,
      status: listingData.status,
      createdAt: dateToTimestamp(listingData.createdAt),
      updatedAt: dateToTimestamp(listingData.updatedAt),
    };

    if (listingData.cardType === 'character') data.characterName = listingData.characterName;

    if (listingData.note !== undefined) {
      data.note = listingData.note;
    }
    if (listingData.sleeveFee !== undefined) data.sleeveFee = listingData.sleeveFee;
    if (listingData.myShipFee !== undefined) data.myShipFee = listingData.myShipFee;

    return data;
  },
  fromFirestore(snapshot, options) {
    const data = readData(snapshot, options);
    const hasNormalizedMetadata = data.cardType !== undefined || data.cardName !== undefined;
    const listing: Listing = {
      id: snapshot.id,
      sellerId: data.sellerId as string,
      cardId: data.cardId as string,
      cardType: (hasNormalizedMetadata ? data.cardType : data.characterName ? 'character' : undefined) as Listing['cardType'],
      cardName: (hasNormalizedMetadata ? data.cardName : data.characterName) as string | undefined,
      characterName: data.characterName as string | undefined,
      rarity: data.rarity as string | undefined,
      imageUrls: data.imageUrls as string[],
      listingPrice: data.listingPrice as number,
      originalQuantity: data.originalQuantity as number,
      remainingQuantity: data.remainingQuantity as number,
      hasSleeve: data.hasSleeve as boolean,
      supportsMyShip: data.supportsMyShip as boolean,
      sleeveFee: data.sleeveFee as number | undefined,
      myShipFee: data.myShipFee as number | undefined,
      note: data.note as string | undefined,
      status: data.status as Listing['status'],
      createdAt: timestampToDate(data.createdAt, 'createdAt'),
      updatedAt: timestampToDate(data.updatedAt, 'updatedAt'),
    };

    validateListing(listing, true);
    return listing;
  },
};

const publicSellerProfileFields = ['createdAt', 'displayName', 'updatedAt'] as const;

function assertCanonicalPublicSellerProfileFields(data: FirestoreData) {
  const fields = Object.keys(data).sort();
  if (
    fields.length !== publicSellerProfileFields.length
    || fields.some((field, index) => field !== publicSellerProfileFields[index])
  ) {
    throw new Error('Public seller profile requires exactly displayName, createdAt, and updatedAt.');
  }
}

export const publicSellerProfileConverter: FirestoreDataConverter<PublicSellerProfile> = {
  toFirestore(profile) {
    const profileData = profile as PublicSellerProfile;
    validatePublicSellerProfile(profileData);

    return {
      displayName: profileData.displayName,
      createdAt: dateToTimestamp(profileData.createdAt),
      updatedAt: dateToTimestamp(profileData.updatedAt),
    };
  },
  fromFirestore(snapshot, options) {
    const data = readData(snapshot, options);
    assertCanonicalPublicSellerProfileFields(data);
    const profile: PublicSellerProfile = {
      uid: snapshot.id,
      displayName: data.displayName as string,
      createdAt: timestampToDate(data.createdAt, 'createdAt'),
      updatedAt: timestampToDate(data.updatedAt, 'updatedAt'),
    };

    validatePublicSellerProfile(profile);
    return profile;
  },
};


export const saleConverter: FirestoreDataConverter<Sale> = {
  toFirestore(sale) {
    const saleData = sale as Sale;
    validateSale(saleData);

    return {
      listingId: saleData.listingId,
      sellerId: saleData.sellerId,
      cardId: saleData.cardId,
      quantity: saleData.quantity,
      listingUnitPrice: saleData.listingUnitPrice,
      soldUnitPrice: saleData.soldUnitPrice,
      soldAt: dateToTimestamp(saleData.soldAt),
    };
  },
  fromFirestore(snapshot, options) {
    const data = readData(snapshot, options);
    const sale: Sale = {
      id: snapshot.id,
      listingId: data.listingId as string,
      sellerId: data.sellerId as string,
      cardId: data.cardId as string,
      quantity: data.quantity as number,
      listingUnitPrice: data.listingUnitPrice as number,
      soldUnitPrice: data.soldUnitPrice as number,
      soldAt: timestampToDate(data.soldAt, 'soldAt'),
    };

    validateSale(sale);
    return sale;
  },
};

export const notificationSubscriptionConverter: FirestoreDataConverter<NotificationSubscription> = {
  toFirestore(subscription) {
    const subscriptionData = subscription as NotificationSubscription;
    validateNotificationSubscription(subscriptionData);

    return {
      cardNames: subscriptionData.cardNames,
      emailDailyEnabled: subscriptionData.emailDailyEnabled,
      updatedAt: dateToTimestamp(subscriptionData.updatedAt),
    };
  },
  fromFirestore(snapshot, options) {
    const subscription = readNotificationSubscriptionDocument(
      snapshot.id,
      readData(snapshot, options),
    );
    if (!subscription) {
      throw new Error('Legacy notification subscription has no current cardNames value.');
    }
    return subscription;
  },
};

const CURRENT_NOTIFICATION_SUBSCRIPTION_FIELDS = [
  'cardNames',
  'emailDailyEnabled',
  'updatedAt',
] as const;
const LEGACY_NOTIFICATION_SUBSCRIPTION_FIELDS = [
  'characterKeys',
  'emailDailyEnabled',
  'updatedAt',
] as const;

function hasExactFields(data: FirestoreData, fields: readonly string[]): boolean {
  const keys = Object.keys(data);
  return keys.length === fields.length && fields.every((field) => keys.includes(field));
}

function isRecognizedLegacyNotificationSubscription(data: FirestoreData): boolean {
  if (!hasExactFields(data, LEGACY_NOTIFICATION_SUBSCRIPTION_FIELDS)
    || !Array.isArray(data.characterKeys)
    || data.characterKeys.length > 100
    || typeof data.emailDailyEnabled !== 'boolean'
    || !(data.updatedAt instanceof Timestamp)) {
    return false;
  }

  const keys = new Set<string>();
  for (const value of data.characterKeys) {
    if (typeof value !== 'string'
      || value !== toCharacterKey(value)
      || value.length > 100
      || keys.has(value)) {
      return false;
    }
    keys.add(value);
  }
  return true;
}

export function readNotificationSubscriptionDocument(
  uid: string,
  value: unknown,
): NotificationSubscription | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Notification subscription document must be an object.');
  }

  const data = value as FirestoreData;
  if (hasExactFields(data, LEGACY_NOTIFICATION_SUBSCRIPTION_FIELDS)) {
    if (!isRecognizedLegacyNotificationSubscription(data)) {
      throw new Error('Legacy notification subscription document is malformed.');
    }
    return null;
  }
  if (!hasExactFields(data, CURRENT_NOTIFICATION_SUBSCRIPTION_FIELDS)) {
    throw new Error('Notification subscription document has invalid fields.');
  }

  const subscription: NotificationSubscription = {
    uid,
    cardNames: data.cardNames as string[],
    emailDailyEnabled: data.emailDailyEnabled as boolean,
    updatedAt: timestampToDate(data.updatedAt, 'updatedAt'),
  };
  validateNotificationSubscription(subscription);
  return subscription;
}
