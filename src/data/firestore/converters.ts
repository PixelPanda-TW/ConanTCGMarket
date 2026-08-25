import {
  Timestamp,
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
  type SnapshotOptions,
} from 'firebase/firestore';
import {
  validateCard,
  validateListing,
  validateSale,
  validateSellerProfile,
  type Card,
  type Listing,
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
      characterName: cardData.characterName,
      rarities: cardData.rarities ?? [cardData.rarity as string],
    };
  },
  fromFirestore(snapshot, options) {
    const data = readData(snapshot, options);
    const characterName = data.characterName ?? data.nameZh ?? data.nameJa;
    const card: Card = {
      id: snapshot.id,
      characterName: characterName as string,
      rarities: Array.isArray(data.rarities) ? data.rarities as string[] : undefined,
      rarity: data.rarity as string | undefined,
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
      characterName: listingData.characterName,
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

    if (listingData.note !== undefined) {
      data.note = listingData.note;
    }

    return data;
  },
  fromFirestore(snapshot, options) {
    const data = readData(snapshot, options);
    const listing: Listing = {
      id: snapshot.id,
      sellerId: data.sellerId as string,
      cardId: data.cardId as string,
      characterName: data.characterName as string | undefined,
      rarity: data.rarity as string | undefined,
      imageUrls: data.imageUrls as string[],
      listingPrice: data.listingPrice as number,
      originalQuantity: data.originalQuantity as number,
      remainingQuantity: data.remainingQuantity as number,
      hasSleeve: data.hasSleeve as boolean,
      supportsMyShip: data.supportsMyShip as boolean,
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
