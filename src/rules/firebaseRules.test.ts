import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage';

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
const legacySubscriptionData = {
  cardNames: ['江戶川柯南', '洗牌情緣'],
  emailDailyEnabled: true,
  updatedAt: new Date(),
};
const subscriptionData = {
  ...legacySubscriptionData,
  sellerSubscriptions: [],
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
    await setDoc(doc(context.firestore(), 'cardMasterArchives', 'card_retired'), {
      ...partnerCardMaster, disposition: 'disabled', rationale: '錯誤卡片',
      actedBy: 'admin-user', actedAt: new Date(),
    });
    await setDoc(doc(context.firestore(), 'cardMasterAuditLogs', 'audit-card-1'), {
      action: 'disable', sourceCardKey: 'card_retired', before: partnerCardMaster,
      rationale: '錯誤卡片', actedBy: 'admin-user', actedAt: new Date(),
    });
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
    await setDoc(doc(context.firestore(), 'sales', 'owner-sale'), saleData);
    await setDoc(doc(context.firestore(), 'sales', 'immutable-owner-sale'), saleData);
    await setDoc(doc(context.firestore(), 'notificationSubscriptions', 'suspended-user'), legacySubscriptionData);
    await setDoc(doc(context.firestore(), 'notificationSubscriptions', 'legacy-owner'), legacySubscriptionData);
    const reportSnapshot = {
      listingId: 'active', cardType: 'event', cardName: '事件測試卡', cardId: '0123',
      rarity: 'SR', listingPrice: 500, createdAt: new Date(),
    };
    const draftReport = {
      status: 'draft', requestKey: 'a'.repeat(64), reporterId: 'active-user',
      targetSellerId: 'seller-a', listingSnapshot: reportSnapshot,
      createdAt: new Date(), expiresAt: new Date('2099-01-01T00:00:00Z'),
    };
    await setDoc(doc(context.firestore(), 'moderationReports', 'report-draft'), draftReport);
    await setDoc(doc(context.firestore(), 'moderationReports', 'report-expired'), {
      ...draftReport, requestKey: 'b'.repeat(64), expiresAt: new Date('2020-01-01T00:00:00Z'),
    });
    await setDoc(doc(context.firestore(), 'moderationReports', 'report-submitted'), {
      ...draftReport, status: 'submitted', requestKey: 'c'.repeat(64), category: 'other',
      description: '說明', evidence: [], submittedAt: new Date(),
    });
    await setDoc(doc(context.firestore(), 'moderationReports', 'report-suspended'), {
      ...draftReport, requestKey: 'd'.repeat(64), reporterId: 'suspended-user',
    });
    await setDoc(doc(context.firestore(), 'moderationReports', 'report-malformed-account'), {
      ...draftReport, requestKey: 'e'.repeat(64), reporterId: 'malformed-active-user',
    });
    await setDoc(doc(context.firestore(), 'moderationReportRequestKeys', 'a'.repeat(64)), {
      reportId: 'report-draft', reporterId: 'active-user', requestIdHash: 'f'.repeat(64),
      createdAt: new Date(),
    });
    await setDoc(doc(context.firestore(), 'moderationReportLimits', 'active-user_2099-01-01'), {
      reporterId: 'active-user', utcDate: '2099-01-01', count: 1,
      createdAt: new Date(), updatedAt: new Date(),
    });
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

  it.each([
    ['moderationReports', 'report-draft'],
    ['moderationReportRequestKeys', 'a'.repeat(64)],
    ['moderationReportLimits', 'active-user_2099-01-01'],
  ])('denies all browser identities every report Firestore operation on %s', async (collectionName, id) => {
    for (const db of [
      environment.unauthenticatedContext().firestore(),
      environment.authenticatedContext('active-user').firestore(),
      environment.authenticatedContext('admin-user', { admin: true }).firestore(),
    ]) {
      await assertFails(getDoc(doc(db, collectionName, id)));
      await assertFails(getDocs(collection(db, collectionName)));
      await assertFails(setDoc(doc(db, collectionName, `${id}-new`), { value: 'blocked' }));
      await assertFails(updateDoc(doc(db, collectionName, id), { value: 'blocked' }));
      await assertFails(deleteDoc(doc(db, collectionName, id)));
    }
  });

  it('allows an active draft owner to create, replace, and delete slots 0–2 but never read them', async () => {
    const owner = environment.authenticatedContext('active-user').storage();
    for (const slot of [0, 1, 2]) {
      const object = ref(owner, `reportEvidence/active-user/report-draft/${slot}`);
      await assertSucceeds(uploadBytes(object, new Blob(['image'], { type: 'image/png' })));
      await assertFails(getBytes(object));
      await assertSucceeds(uploadBytes(object, new Blob(['replacement'], { type: 'image/webp' })));
      await assertSucceeds(deleteObject(object));
    }
    await assertFails(getBytes(ref(
      environment.unauthenticatedContext().storage(),
      'reportEvidence/active-user/report-draft/0',
    )));
  });

  it.each([
    ['unauthenticated', null, 'active-user', 'report-draft', '0', 'image/png', 1],
    ['owner mismatch', 'other-user', 'active-user', 'report-draft', '0', 'image/png', 1],
    ['suspended', 'suspended-user', 'suspended-user', 'report-suspended', '0', 'image/png', 1],
    ['malformed access', 'malformed-active-user', 'malformed-active-user', 'report-malformed-account', '0', 'image/png', 1],
    ['expired draft', 'active-user', 'active-user', 'report-expired', '0', 'image/png', 1],
    ['submitted report', 'active-user', 'active-user', 'report-submitted', '0', 'image/png', 1],
    ['invalid slot', 'active-user', 'active-user', 'report-draft', '3', 'image/png', 1],
    ['nested slot', 'active-user', 'active-user', 'report-draft', '0/extra', 'image/png', 1],
    ['wrong MIME', 'active-user', 'active-user', 'report-draft', '0', 'application/pdf', 1],
    ['empty object', 'active-user', 'active-user', 'report-draft', '0', 'image/png', 0],
    ['oversized object', 'active-user', 'active-user', 'report-draft', '0', 'image/png', 5 * 1024 * 1024 + 1],
  ])('denies invalid report evidence write: %s', async (
    _label, authUid, pathUid, reportId, slot, contentType, size,
  ) => {
    const storage = authUid
      ? environment.authenticatedContext(authUid).storage()
      : environment.unauthenticatedContext().storage();
    await assertFails(uploadBytes(
      ref(storage, `reportEvidence/${pathUid}/${reportId}/${slot}`),
      new Blob([new Uint8Array(size)], { type: contentType }),
    ));
  });

  it('denies replacement and delete after the draft becomes submitted', async () => {
    const owner = environment.authenticatedContext('active-user').storage();
    const object = ref(owner, 'reportEvidence/active-user/report-post-submit/0');
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'moderationReports', 'report-post-submit'), {
        status: 'draft', requestKey: 'f'.repeat(64), reporterId: 'active-user',
        targetSellerId: 'seller-a',
        listingSnapshot: {
          listingId: 'active', cardType: 'event', cardName: '事件測試卡',
          cardId: '0123', rarity: 'SR', listingPrice: 500, createdAt: new Date(),
        },
        createdAt: new Date(), expiresAt: new Date('2099-01-01T00:00:00Z'),
      });
    });
    await assertSucceeds(uploadBytes(object, new Blob(['image'], { type: 'image/png' })));
    await environment.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), 'moderationReports', 'report-post-submit'), {
        status: 'submitted', category: 'other', description: '說明', evidence: [],
        submittedAt: new Date(),
      });
    });
    await assertFails(uploadBytes(object, new Blob(['replacement'], { type: 'image/png' })));
    await assertFails(deleteObject(object));
    await assertFails(getBytes(object));
  });

  it.each(['missing-user', 'active-user'])(
    'allows only approved browser mutations for %s account access',
    async (uid) => {
      const db = environment.authenticatedContext(uid).firestore();
      const listing = doc(db, 'listings', `${uid}-new-listing`);
      const subscription = doc(db, 'notificationSubscriptions', uid);

      await assertFails(setDoc(doc(db, 'sellerProfiles', uid), {
        displayName: uid, createdAt: new Date(), updatedAt: new Date(),
      }));
      await assertSucceeds(setDoc(listing, { ...eventListing, sellerId: uid }));
      await assertFails(updateDoc(listing, { listingPrice: 450 }));
      await assertFails(setDoc(doc(db, 'sales', `${uid}-sale`), {
        ...saleData,
        sellerId: uid,
        listingId: `${uid}-listing`,
      }));
      await assertSucceeds(setDoc(subscription, subscriptionData));
      await assertSucceeds(updateDoc(subscription, { emailDailyEnabled: false }));
      await assertSucceeds(deleteDoc(subscription));
      await assertFails(deleteDoc(listing));
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
  it.each([
    ['unknown field', { ...eventListing, unexpected: true }],
    ['initial inventory mismatch', { ...eventListing, remainingQuantity: 4 }],
    ['sold-out status', { ...eventListing, status: 'sold_out' }],
    ['missing card snapshot', { ...activeListing }],
    ['invalid image count', { ...eventListing, imageUrls: [] }],
    ['invalid price', { ...eventListing, listingPrice: 0 }],
    ['invalid service fee', { ...eventListing, sleeveFee: -1 }],
  ])('rejects malformed Listing creation: %s', async (_name, data) => {
    const owner = environment.authenticatedContext('seller-a').firestore();
    await assertFails(setDoc(doc(owner, 'listings', `invalid-${_name}`), data));
  });
  it('denies a direct owner lifecycle transaction even when its arithmetic is consistent', async () => {
    const owner = environment.authenticatedContext('seller-a').firestore();
    await assertFails(updateDoc(doc(owner, 'listings', 'active'), {
      remainingQuantity: 4, status: 'active', updatedAt: new Date(),
    }));
    await assertFails(setDoc(doc(owner, 'sales', 'direct-sale'), {
      ...saleData,
      cardType: 'case', cardName: '封鎖現場', rarity: 'SR',
    }));
    await assertFails(deleteDoc(doc(owner, 'listings', 'active')));
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
  it.each([
    ['cardMasterArchives', 'card_retired'],
    ['cardMasterAuditLogs', 'audit-card-1'],
  ])('explicitly isolates Card Master Admin collection %s from every browser identity', async (collectionName, id) => {
    const identities = [
      environment.unauthenticatedContext().firestore(),
      environment.authenticatedContext('buyer-user').firestore(),
      environment.authenticatedContext('admin-user', { admin: true }).firestore(),
    ];
    for (const db of identities) {
      const existing = doc(db, collectionName, id);
      await assertFails(getDoc(existing));
      await assertFails(getDocs(collection(db, collectionName)));
      await assertFails(setDoc(doc(db, collectionName, `${id}-create`), { value: 'blocked' }));
      await assertFails(updateDoc(existing, { rationale: 'tampered' }));
      await assertFails(deleteDoc(existing));
    }
  });

  it('uses explicit unconditional deny matches without a browser admin-claim shortcut', async () => {
    const rules = await readFile('firestore.rules', 'utf8');
    expect(rules).toMatch(/match \/cardMasterArchives\/\{id\}[\s\S]*?allow read, write: if false;/u);
    expect(rules).toMatch(/match \/cardMasterAuditLogs\/\{id\}[\s\S]*?allow read, write: if false;/u);
    expect(rules).not.toMatch(/request\.auth\.token\.admin/u);
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
  it('allows bounded canonical seller subscriptions and preserves legacy owner reads', async () => {
    const owner = environment.authenticatedContext('seller-subscription-owner').firestore();
    const subscription = doc(owner, 'notificationSubscriptions', 'seller-subscription-owner');
    const followedAt = new Date('2026-09-04T00:00:00.000Z');

    await assertSucceeds(setDoc(subscription, {
      ...subscriptionData,
      sellerSubscriptions: [{ sellerId: 'seller-a', followedAt }],
    }));
    await assertSucceeds(updateDoc(subscription, {
      sellerSubscriptions: [
        { sellerId: 'seller-a', followedAt },
        { sellerId: 'seller-b', followedAt },
      ],
    }));
    await assertSucceeds(getDoc(subscription));
    await assertSucceeds(deleteDoc(subscription));

    const legacyOwner = environment.authenticatedContext('legacy-owner').firestore();
    await assertSucceeds(getDoc(doc(legacyOwner, 'notificationSubscriptions', 'legacy-owner')));
  });

  it.each([
    ['legacy card-only write', legacySubscriptionData],
    ['non-list sellers', { ...subscriptionData, sellerSubscriptions: 'seller-a' }],
    ['too many sellers', { ...subscriptionData, sellerSubscriptions: Array.from(
      { length: 101 },
      (_, index) => ({ sellerId: `seller-${index}`, followedAt: new Date() }),
    ) }],
  ])('rejects malformed seller subscription shape: %s', async (_label, value) => {
    const owner = environment.authenticatedContext(`invalid-seller-${_label}`).firestore();
    await assertFails(setDoc(
      doc(owner, 'notificationSubscriptions', `invalid-seller-${_label}`),
      value,
    ));
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
    for (const [collectionName, id] of [
      ['listingEvents', 'listing-1'],
      ['notificationDeliveryState', 'buyer-a'],
      ['notificationDigestRuns', '2026-09-04'],
      ['notificationDigestRuntime', 'batchCursor'],
    ]) {
      await assertFails(getDoc(doc(buyer, collectionName, id)));
      await assertFails(setDoc(doc(buyer, collectionName, id), { value: 'blocked' }));
    }
  });
  it('allows only the owner to read/query server-created immutable Sale records', async () => {
    const owner = environment.authenticatedContext('seller-a').firestore();
    const otherSeller = environment.authenticatedContext('seller-b').firestore();
    const publicDb = environment.unauthenticatedContext().firestore();
    const ownerSale = doc(owner, 'sales', 'owner-sale');

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
  it('rejects every browser create, update, and delete of Sale records', async () => {
    const owner = environment.authenticatedContext('seller-a').firestore();
    const immutableSale = doc(owner, 'sales', 'immutable-owner-sale');

    await assertFails(setDoc(doc(owner, 'sales', 'new-owner-sale'), saleData));
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
