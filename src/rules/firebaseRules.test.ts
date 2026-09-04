import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { deleteObject, ref, uploadBytes } from 'firebase/storage';

let environment: RulesTestEnvironment;
const activeListing = { sellerId: 'seller-a', cardId: 'CP-001', imageUrls: ['https://example.test/card.jpg'], listingPrice: 500, originalQuantity: 5, remainingQuantity: 5, hasSleeve: true, supportsMyShip: true, status: 'active', createdAt: new Date(), updatedAt: new Date() };
const eventListing = {
  ...activeListing,
  cardId: '0123',
  cardType: 'event',
  cardName: '事件測試卡',
  rarity: 'SR',
};
const eventCardMaster = {
  cardType: 'event',
  cardName: '事件測試卡',
  rarities: ['SR'],
};
const partnerCardMaster = {
  cardId: 'P001',
  cardType: 'partner',
  cardName: '江戶川柯南',
  rarities: ['P'],
};
const subscriptionData = {
  cardNames: ['江戶川柯南', '洗牌情緣'],
  emailDailyEnabled: true,
  updatedAt: new Date(),
};
const saleData = {
  listingId: 'active',
  sellerId: 'seller-a',
  cardId: '0501',
  quantity: 1,
  listingUnitPrice: 500,
  soldUnitPrice: 450,
  soldAt: new Date(),
};
const activeAccountAccess = {
  status: 'active',
  confirmedViolationCount: 0,
  updatedAt: new Date(),
};
const suspendedAccountAccess = {
  status: 'suspended',
  confirmedViolationCount: 1,
  suspensionReason: 'Confirmed marketplace policy violation.',
  suspendedAt: new Date(),
  suspendedBy: 'admin-1',
  updatedAt: new Date(),
};

beforeAll(async () => {
  environment = await initializeTestEnvironment({ projectId: 'demo-conan-tcg', firestore: { rules: await readFile('firestore.rules', 'utf8') }, storage: { rules: await readFile('storage.rules', 'utf8') } });
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'cards', '0123'), eventCardMaster);
    await setDoc(doc(context.firestore(), 'cards', 'card_test_hash'), partnerCardMaster);
    await setDoc(doc(context.firestore(), 'listings', 'active'), activeListing);
    await setDoc(doc(context.firestore(), 'listings', 'sold'), { ...activeListing, status: 'sold_out' });
    await setDoc(doc(context.firestore(), 'accountAccess', 'active-user'), activeAccountAccess);
    await setDoc(doc(context.firestore(), 'accountAccess', 'suspended-user'), suspendedAccountAccess);
    await setDoc(doc(context.firestore(), 'accountAccess', 'malformed-active-user'), {
      ...activeAccountAccess,
      unexpected: true,
    });
    await setDoc(doc(context.firestore(), 'sellerProfiles', 'seller-a'), {
      displayName: 'Seller A', createdAt: new Date(), updatedAt: new Date(),
    });
    await setDoc(doc(context.firestore(), 'sellerProfiles', 'legacy-public-contact'), {
      displayName: 'Legacy', contactType: 'line', contactValue: 'must-not-be-public',
      createdAt: new Date(), updatedAt: new Date(),
    });
    await setDoc(doc(context.firestore(), 'sellerContacts', 'seller-a'), {
      contactType: 'line', contactValue: 'seller-a', createdAt: new Date(), updatedAt: new Date(),
    });
    await setDoc(doc(context.firestore(), 'sellerContactAccessLogs', 'audit-1'), {
      requesterUid: 'active-user', sellerUid: 'seller-a', listingId: 'active',
      outcome: 'revealed', createdAt: new Date(),
    });
    await setDoc(doc(context.firestore(), 'sellerContactRequesterLimits', 'active-user:2026090403'), { count: 1 });
    await setDoc(doc(context.firestore(), 'sellerContactSellerLimits', 'seller-a:2026090403'), { count: 1 });
    for (const uid of ['missing-user', 'active-user', 'suspended-user', 'malformed-active-user']) {
      await setDoc(doc(context.firestore(), 'listings', `${uid}-listing`), {
        ...activeListing,
        sellerId: uid,
        status: 'sold_out',
      });
    }
    await setDoc(doc(context.firestore(), 'sales', 'suspended-user-sale'), {
      ...saleData,
      listingId: 'suspended-user-listing',
      sellerId: 'suspended-user',
    });
    await setDoc(doc(context.firestore(), 'notificationSubscriptions', 'suspended-user'), subscriptionData);
    await uploadBytes(
      ref(context.storage(), 'listings/suspended-user/existing/card.jpg'),
      new Blob(['image'], { type: 'image/jpeg' }),
    );
  });
});
afterAll(async () => environment?.cleanup());

describe('Firebase rules', () => {
  it('allows only the owner to read account access and denies every browser write', async () => {
    const owner = environment.authenticatedContext('suspended-user').firestore();
    const other = environment.authenticatedContext('other-user').firestore();
    const publicDb = environment.unauthenticatedContext().firestore();
    const ownerAccess = doc(owner, 'accountAccess', 'suspended-user');

    await assertSucceeds(getDoc(ownerAccess));
    await assertFails(getDoc(doc(other, 'accountAccess', 'suspended-user')));
    await assertFails(getDoc(doc(publicDb, 'accountAccess', 'suspended-user')));
    await assertFails(setDoc(doc(owner, 'accountAccess', 'new-owner-state'), activeAccountAccess));
    await assertFails(updateDoc(ownerAccess, { status: 'active' }));
    await assertFails(deleteDoc(ownerAccess));
  });

  it.each(['missing-user', 'active-user'])(
    'allows current owner mutations for %s account access',
    async (uid) => {
      const db = environment.authenticatedContext(uid).firestore();
      const listing = doc(db, 'listings', `${uid}-new-listing`);
      const subscription = doc(db, 'notificationSubscriptions', uid);

      await assertFails(setDoc(doc(db, 'sellerProfiles', uid), {
        displayName: uid, createdAt: new Date(), updatedAt: new Date(),
      }));
      await assertSucceeds(setDoc(listing, { ...eventListing, sellerId: uid }));
      await assertSucceeds(updateDoc(listing, { listingPrice: 450 }));
      await assertSucceeds(setDoc(doc(db, 'sales', `${uid}-sale`), {
        ...saleData,
        sellerId: uid,
        listingId: `${uid}-listing`,
      }));
      await assertSucceeds(setDoc(subscription, subscriptionData));
      await assertSucceeds(updateDoc(subscription, { emailDailyEnabled: false }));
      await assertSucceeds(deleteDoc(subscription));
      await assertSucceeds(deleteDoc(listing));
    },
  );

  it.each(['suspended-user', 'malformed-active-user'])(
    'denies every current owner mutation for %s account access',
    async (uid) => {
      const db = environment.authenticatedContext(uid).firestore();

      await assertFails(setDoc(doc(db, 'sellerProfiles', uid), {
        displayName: uid, contactType: 'line', contactValue: uid,
      }));
      await assertFails(setDoc(doc(db, 'listings', `${uid}-new-listing`), {
        ...eventListing,
        sellerId: uid,
      }));
      await assertFails(updateDoc(doc(db, 'listings', `${uid}-listing`), {
        listingPrice: 450,
      }));
      await assertFails(deleteDoc(doc(db, 'listings', `${uid}-listing`)));
      await assertFails(setDoc(doc(db, 'sales', `${uid}-new-sale`), {
        ...saleData,
        sellerId: uid,
        listingId: `${uid}-listing`,
      }));
      await assertFails(setDoc(doc(db, 'notificationSubscriptions', uid), subscriptionData));
      await assertFails(updateDoc(doc(db, 'notificationSubscriptions', uid), {
        emailDailyEnabled: false,
      }));
      await assertFails(deleteDoc(doc(db, 'notificationSubscriptions', uid)));
    },
  );

  it('preserves suspended owner history reads', async () => {
    const db = environment.authenticatedContext('suspended-user').firestore();

    await assertSucceeds(getDoc(doc(db, 'listings', 'suspended-user-listing')));
    await assertSucceeds(getDoc(doc(db, 'sales', 'suspended-user-sale')));
    await assertSucceeds(getDoc(doc(db, 'notificationSubscriptions', 'suspended-user')));
  });

  it.each(['missing-user', 'active-user'])(
    'allows Listing image writes for %s account access',
    async (uid) => {
      const storage = environment.authenticatedContext(uid).storage();
      const image = ref(storage, `listings/${uid}/listing/card.jpg`);
      await assertSucceeds(uploadBytes(image, new Blob(['image'], { type: 'image/jpeg' })));
      await assertSucceeds(deleteObject(image));
    },
  );

  it.each(['suspended-user', 'malformed-active-user'])(
    'denies Listing image writes for %s account access',
    async (uid) => {
      const storage = environment.authenticatedContext(uid).storage();
      await assertFails(uploadBytes(
        ref(storage, `listings/${uid}/new/card.jpg`),
        new Blob(['image'], { type: 'image/jpeg' }),
      ));
      if (uid === 'suspended-user') {
        await assertFails(deleteObject(ref(storage, 'listings/suspended-user/existing/card.jpg')));
      }
    },
  );

  it('allows an owner to create a generic Listing but rejects public and cross-seller writes', async () => {
    const sellerA = environment.authenticatedContext('seller-a').firestore();
    const sellerB = environment.authenticatedContext('seller-b').firestore();
    const unauthenticated = environment.unauthenticatedContext().firestore();
    const listing = doc(sellerA, 'listings', 'event-listing');

    await assertSucceeds(setDoc(listing, eventListing));
    await assertFails(setDoc(doc(unauthenticated, 'listings', 'blocked'), eventListing));
    await assertFails(setDoc(doc(sellerB, 'listings', 'event-listing'), { ...eventListing, listingPrice: 1 }));
  });
  it('allows public active and owner private Listing reads but rejects sold-out cross-user reads', async () => {
    const publicDb = environment.unauthenticatedContext().firestore();
    const ownerDb = environment.authenticatedContext('seller-a').firestore();
    const otherDb = environment.authenticatedContext('seller-b').firestore();

    await assertSucceeds(getDocs(query(collection(publicDb, 'listings'), where('status', '==', 'active'))));
    await assertSucceeds(getDoc(doc(ownerDb, 'listings', 'sold')));
    await assertFails(getDoc(doc(publicDb, 'listings', 'sold')));
    await assertFails(getDoc(doc(otherDb, 'listings', 'sold')));
  });
  it('rejects a seller modifying another seller listing', async () => {
    await assertFails(setDoc(doc(environment.authenticatedContext('seller-b').firestore(), 'listings', 'active'), { ...activeListing, listingPrice: 1 }));
  });
  it('allows public Card Master reads while keeping client writes protected', async () => {
    const publicDb = environment.unauthenticatedContext().firestore();
    const sellerA = environment.authenticatedContext('seller-a').firestore();
    const publicCard = doc(publicDb, 'cards', 'card_test_hash');
    const authenticatedCard = doc(sellerA, 'cards', 'card_test_hash');
    const card = await assertSucceeds(getDoc(publicCard));

    expect(card.data()).toEqual(partnerCardMaster);
    await assertFails(setDoc(doc(publicDb, 'cards', 'card_public_create'), partnerCardMaster));
    await assertFails(updateDoc(publicCard, { cardName: '公開篡改' }));
    await assertFails(deleteDoc(publicCard));
    await assertFails(setDoc(doc(sellerA, 'cards', 'card_authenticated_create'), partnerCardMaster));
    await assertFails(updateDoc(authenticatedCard, { cardName: '認證篡改' }));
    await assertFails(deleteDoc(authenticatedCard));
  });
  it('allows only strict public profile reads and denies every browser profile write', async () => {
    const sellerA = environment.authenticatedContext('seller-a').firestore();
    const sellerB = environment.authenticatedContext('seller-b').firestore();
    const publicDb = environment.unauthenticatedContext().firestore();

    await assertSucceeds(getDoc(doc(publicDb, 'sellerProfiles', 'seller-a')));
    await assertSucceeds(getDoc(doc(sellerB, 'sellerProfiles', 'seller-a')));
    await assertFails(getDoc(doc(publicDb, 'sellerProfiles', 'legacy-public-contact')));
    await assertFails(setDoc(doc(sellerA, 'sellerProfiles', 'seller-a'), {
      displayName: 'A', createdAt: new Date(), updatedAt: new Date(),
    }));
    await assertFails(updateDoc(doc(sellerA, 'sellerProfiles', 'seller-a'), { displayName: 'Changed' }));
    await assertFails(deleteDoc(doc(sellerA, 'sellerProfiles', 'seller-a')));
    await assertFails(setDoc(doc(sellerB, 'sellerProfiles', 'seller-a'), {
      displayName: 'B', createdAt: new Date(), updatedAt: new Date(),
    }));
  });

  it.each([
    ['sellerContacts', 'seller-a'],
    ['sellerContactAccessLogs', 'audit-1'],
    ['sellerContactRequesterLimits', 'active-user:2026090403'],
    ['sellerContactSellerLimits', 'seller-a:2026090403'],
  ])('denies every browser read and write of server-only %s', async (collectionName, id) => {
    const identities = [
      environment.unauthenticatedContext().firestore(),
      environment.authenticatedContext('seller-a').firestore(),
      environment.authenticatedContext('active-user').firestore(),
      environment.authenticatedContext('suspended-user').firestore(),
      environment.authenticatedContext('malformed-active-user').firestore(),
    ];
    for (const db of identities) {
      await assertFails(getDoc(doc(db, collectionName, id)));
      await assertFails(setDoc(doc(db, collectionName, `${id}-write`), { value: 'blocked' }));
    }
  });
  it('allows an owner to create, read, update, and delete a card name subscription', async () => {
    const buyerA = environment.authenticatedContext('buyer-a').firestore();
    const publicDb = environment.unauthenticatedContext().firestore();
    const subscription = doc(buyerA, 'notificationSubscriptions', 'buyer-a');

    await assertSucceeds(setDoc(subscription, subscriptionData));
    await assertSucceeds(getDoc(subscription));
    await assertFails(getDoc(doc(publicDb, 'notificationSubscriptions', 'buyer-a')));
    await assertSucceeds(updateDoc(subscription, { cardNames: [] }));
    await assertSucceeds(deleteDoc(subscription));
  });
  it('rejects another buyer and unauthenticated users reading or writing a subscription', async () => {
    const owner = environment.authenticatedContext('subscription-owner').firestore();
    const otherBuyer = environment.authenticatedContext('other-buyer').firestore();
    const unauthenticated = environment.unauthenticatedContext().firestore();
    const ownerSubscription = doc(owner, 'notificationSubscriptions', 'subscription-owner');

    await assertSucceeds(setDoc(ownerSubscription, subscriptionData));
    await assertFails(getDoc(doc(otherBuyer, 'notificationSubscriptions', 'subscription-owner')));
    await assertFails(setDoc(doc(otherBuyer, 'notificationSubscriptions', 'subscription-owner'), subscriptionData));
    await assertFails(getDoc(doc(unauthenticated, 'notificationSubscriptions', 'subscription-owner')));
    await assertFails(setDoc(doc(unauthenticated, 'notificationSubscriptions', 'subscription-owner'), subscriptionData));
  });
  it('rejects legacy, extra-field, duplicate, and oversized subscription writes', async () => {
    const buyer = environment.authenticatedContext('buyer-limits').firestore();
    const subscription = doc(buyer, 'notificationSubscriptions', 'buyer-limits');

    await assertFails(setDoc(subscription, { characterKeys: ['江戶川柯南'], emailDailyEnabled: true, updatedAt: new Date() }));
    await assertFails(setDoc(subscription, { ...subscriptionData, email: 'buyer@example.com' }));
    await assertFails(setDoc(subscription, { ...subscriptionData, cardNames: ['江戶川柯南', '江戶川柯南'] }));
    await assertFails(setDoc(subscription, { ...subscriptionData, cardNames: Array.from({ length: 101 }, (_, index) => `卡名-${index}`) }));
  });
  it('rejects a non-boolean daily email preference', async () => {
    const buyer = environment.authenticatedContext('buyer-preference-type').firestore();
    const subscription = doc(
      buyer,
      'notificationSubscriptions',
      'buyer-preference-type',
    );

    await assertFails(setDoc(subscription, {
      ...subscriptionData,
      emailDailyEnabled: 'true',
    }));
  });
  it('rejects all browser reads and writes of notification events and delivery state', async () => {
    const buyer = environment.authenticatedContext('buyer-a').firestore();
    await assertFails(getDoc(doc(buyer, 'listingEvents', 'listing-1')));
    await assertFails(setDoc(doc(buyer, 'notificationDeliveryState', 'buyer-a'), {}));
  });
  it('allows only the Listing owner to create and query immutable Sale records', async () => {
    const owner = environment.authenticatedContext('seller-a').firestore();
    const otherSeller = environment.authenticatedContext('seller-b').firestore();
    const publicDb = environment.unauthenticatedContext().firestore();
    const ownerSale = doc(owner, 'sales', 'owner-sale');

    await assertSucceeds(setDoc(ownerSale, saleData));
    await assertSucceeds(getDoc(ownerSale));
    await assertSucceeds(getDocs(query(
      collection(owner, 'sales'),
      where('sellerId', '==', 'seller-a'),
    )));
    await assertFails(setDoc(doc(otherSeller, 'sales', 'cross-sale'), {
      ...saleData,
      sellerId: 'seller-b',
      listingId: 'active',
    }));
    await assertFails(setDoc(doc(otherSeller, 'sales', 'missing-listing-sale'), {
      ...saleData,
      sellerId: 'seller-b',
      listingId: 'does-not-exist',
    }));
    await assertFails(setDoc(doc(publicDb, 'sales', 'public-sale'), saleData));
    await assertFails(getDoc(doc(otherSeller, 'sales', 'owner-sale')));
    await assertFails(getDocs(query(
      collection(otherSeller, 'sales'),
      where('sellerId', '==', 'seller-a'),
    )));
    await assertFails(getDoc(doc(publicDb, 'sales', 'owner-sale')));
  });
  it('rejects even the Sale owner updating or deleting an immutable record', async () => {
    const owner = environment.authenticatedContext('seller-a').firestore();
    const immutableSale = doc(owner, 'sales', 'immutable-owner-sale');

    await assertSucceeds(setDoc(immutableSale, saleData));
    const updateFailure = await assertFails(updateDoc(immutableSale, { soldUnitPrice: 400 }));
    expect(updateFailure.code).toBe('permission-denied');
    const deleteFailure = await assertFails(deleteDoc(immutableSale));
    expect(deleteFailure.code).toBe('permission-denied');
    await assertSucceeds(getDoc(immutableSale));
  });
  it('allows a seller to create and delete an image only within that seller path', async () => {
    const ownerStorage = environment.authenticatedContext('seller-a').storage();
    const otherStorage = environment.authenticatedContext('seller-b').storage();
    const ownerImage = ref(ownerStorage, 'listings/seller-a/listing-1/card.jpg');

    await assertSucceeds(uploadBytes(ownerImage, new Blob(['image'], { type: 'image/jpeg' })));
    await assertFails(uploadBytes(ref(ownerStorage, 'listings/seller-b/listing-1/card.jpg'), new Blob(['image'], { type: 'image/jpeg' })));
    await assertFails(deleteObject(ref(otherStorage, 'listings/seller-a/listing-1/card.jpg')));
    await assertSucceeds(deleteObject(ownerImage));
  });
});
