import {
  Timestamp,
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
  type SnapshotOptions,
} from 'firebase/firestore';
import {
  validateCard,
  validateListing,
  validateNotificationSubscription,
  validateSale,
  validateSellerProfile,
  type Card,
  type Listing,
  type NotificationSubscription,
  type Sale,
  type SellerProfile,
} from '../../domain/models';

type FirestoreData = Record<string, unknown>;

function readData(snapshot: QueryDocumentSnapshot, options?: SnapshotOptions): FirestoreData {
  return snapshot.data(options);
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

export const cardConverter: FirestoreDataConverter<Card> = {
  toFirestore(card) {
    const cardData = card as Card;
    validateCard(cardData);
    return {
      cardType: cardData.cardType,
      cardName: cardData.cardName,
      rarities: cardData.rarities,
    };
  },
  fromFirestore(snapshot, options) {
    const data = readData(snapshot, options);
    const cardName = data.cardName ?? data.characterName ?? data.nameZh ?? data.nameJa;
    const card: Card = {
      id: snapshot.id,
      cardType: (data.cardType ?? 'character') as Card['cardType'],
      cardName: cardName as string,
      rarities: Array.isArray(data.rarities)
        ? data.rarities as string[]
        : [data.rarity as string],
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

export const sellerProfileConverter: FirestoreDataConverter<SellerProfile> = {
  toFirestore(profile) {
    const profileData = profile as SellerProfile;
    validateSellerProfile(profileData);

    return {
      displayName: profileData.displayName,
      contactType: profileData.contactType,
      contactValue: profileData.contactValue,
      createdAt: dateToTimestamp(profileData.createdAt),
      updatedAt: dateToTimestamp(profileData.updatedAt),
    };
  },
  fromFirestore(snapshot, options) {
    const data = readData(snapshot, options);
    const profile: SellerProfile = {
      uid: snapshot.id,
      displayName: data.displayName as string,
      contactType: data.contactType as SellerProfile['contactType'],
      contactValue: data.contactValue as string,
      createdAt: timestampToDate(data.createdAt, 'createdAt'),
      updatedAt: timestampToDate(data.updatedAt, 'updatedAt'),
    };

    validateSellerProfile(profile);
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
      characterKeys: subscriptionData.characterKeys,
      emailDailyEnabled: subscriptionData.emailDailyEnabled,
      updatedAt: dateToTimestamp(subscriptionData.updatedAt),
    };
  },
  fromFirestore(snapshot, options) {
    const data = readData(snapshot, options);
    const subscription: NotificationSubscription = {
      uid: snapshot.id,
      characterKeys: data.characterKeys as string[],
      emailDailyEnabled: data.emailDailyEnabled as boolean,
      updatedAt: timestampToDate(data.updatedAt, 'updatedAt'),
    };

    validateNotificationSubscription(subscription);
    return subscription;
  },
};
