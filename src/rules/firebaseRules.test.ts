import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';

let environment: RulesTestEnvironment;
const activeListing = { sellerId: 'seller-a', cardId: 'CP-001', imageUrls: ['https://example.test/card.jpg'], listingPrice: 500, originalQuantity: 5, remainingQuantity: 5, hasSleeve: true, supportsMyShip: true, status: 'active', createdAt: new Date(), updatedAt: new Date() };
const eventListing = {
  ...activeListing,
  cardId: '0123',
  cardType: 'event',
  cardName: '事件測試卡',
  rarity: 'SR',
};

beforeAll(async () => {
  environment = await initializeTestEnvironment({ projectId: 'demo-conan-tcg', firestore: { rules: await readFile('firestore.rules', 'utf8') }, storage: { rules: await readFile('storage.rules', 'utf8') } });
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'listings', 'active'), activeListing);
    await setDoc(doc(context.firestore(), 'listings', 'sold'), { ...activeListing, status: 'sold_out' });
  });
});
afterAll(async () => environment?.cleanup());

describe('Firebase rules', () => {
  it('allows an owner to create a generic Listing but rejects another seller mutation', async () => {
    const sellerA = environment.authenticatedContext('seller-a').firestore();
    const sellerB = environment.authenticatedContext('seller-b').firestore();
    const listing = doc(sellerA, 'listings', 'event-listing');

    await assertSucceeds(setDoc(listing, eventListing));
    await assertFails(setDoc(doc(sellerB, 'listings', 'event-listing'), { ...eventListing, listingPrice: 1 }));
  });
  it('allows public active-listing reads but rejects sold-out reads', async () => {
    const db = environment.unauthenticatedContext().firestore();
    await assertSucceeds(getDocs(query(collection(db, 'listings'), where('status', '==', 'active'))));
    await assertFails(getDoc(doc(db, 'listings', 'sold')));
  });
  it('rejects a seller modifying another seller listing', async () => {
    await assertFails(setDoc(doc(environment.authenticatedContext('seller-b').firestore(), 'listings', 'active'), { ...activeListing, listingPrice: 1 }));
  });
  it('keeps Card Master client-write protected and profiles owner-write only', async () => {
    const sellerA = environment.authenticatedContext('seller-a').firestore();
    const sellerB = environment.authenticatedContext('seller-b').firestore();
    await assertFails(setDoc(doc(sellerA, 'cards', 'CP-001'), { rarity: 'CP', nameZh: '諸伏景光' }));
    await assertSucceeds(setDoc(doc(sellerA, 'sellerProfiles', 'seller-a'), { displayName: 'A', contactType: 'line', contactValue: 'a' }));
    await assertFails(setDoc(doc(sellerB, 'sellerProfiles', 'seller-a'), { displayName: 'B', contactType: 'line', contactValue: 'b' }));
  });
  it('rejects another buyer reading or writing a subscription', async () => {
    const buyerA = environment.authenticatedContext('buyer-a').firestore();
    const buyerB = environment.authenticatedContext('buyer-b').firestore();
    const subscriptionData = { characterKeys: ['suzuki-sonoko'], emailDailyEnabled: true, updatedAt: new Date() };
    await assertSucceeds(setDoc(doc(buyerA, 'notificationSubscriptions', 'buyer-a'), subscriptionData));
    await assertFails(getDoc(doc(buyerB, 'notificationSubscriptions', 'buyer-a')));
    await assertFails(setDoc(doc(buyerB, 'notificationSubscriptions', 'buyer-a'), subscriptionData));
  });
  it('rejects an owner subscription write with an email field', async () => {
    const buyer = environment.authenticatedContext('buyer-a').firestore();
    await assertFails(setDoc(doc(buyer, 'notificationSubscriptions', 'buyer-a'), {
      characterKeys: ['suzuki-sonoko'],
      emailDailyEnabled: true,
      updatedAt: new Date(),
      email: 'buyer@example.com',
    }));
  });
  it('rejects duplicate or excessively large subscription key lists', async () => {
    const buyer = environment.authenticatedContext('buyer-limits').firestore();
    await assertFails(setDoc(doc(buyer, 'notificationSubscriptions', 'buyer-limits'), {
      characterKeys: ['suzuki-sonoko', 'suzuki-sonoko'],
      emailDailyEnabled: true,
      updatedAt: new Date(),
    }));
    await assertFails(setDoc(doc(buyer, 'notificationSubscriptions', 'buyer-limits'), {
      characterKeys: Array.from({ length: 101 }, (_, index) => `character-${index}`),
      emailDailyEnabled: true,
      updatedAt: new Date(),
    }));
  });
  it('rejects all browser reads and writes of notification events and delivery state', async () => {
    const buyer = environment.authenticatedContext('buyer-a').firestore();
    await assertFails(getDoc(doc(buyer, 'listingEvents', 'listing-1')));
    await assertFails(setDoc(doc(buyer, 'notificationDeliveryState', 'buyer-a'), {}));
  });
  it('allows a seller image only within that seller path', async () => {
    const storage = environment.authenticatedContext('seller-a').storage();
    await assertSucceeds(uploadBytes(ref(storage, 'listings/seller-a/listing-1/card.jpg'), new Blob(['image'], { type: 'image/jpeg' })));
    await assertFails(uploadBytes(ref(storage, 'listings/seller-b/listing-1/card.jpg'), new Blob(['image'], { type: 'image/jpeg' })));
  });
});
