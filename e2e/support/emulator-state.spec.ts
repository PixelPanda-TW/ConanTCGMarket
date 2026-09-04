import { expect, test } from '@playwright/test';
import { Timestamp } from 'firebase-admin/firestore';

import {
  assertSafeEmulatorEnvironment,
  E2E_BUCKET,
  listDocuments,
  listStorageObjects,
  readDocument,
  resetEmulators,
  seedListingImage,
  seedScenario,
} from './emulator-state';

test('reset and seed own a clean demo project', async () => {
  await resetEmulators();
  await seedScenario({
    cards: [{
      key: 'e2e-card-0501',
      cardId: '0501',
      cardType: 'character',
      cardName: '諸伏高明',
      rarities: ['D'],
    }],
  });

  await expect.poll(() => readDocument('cards', 'e2e-card-0501')).not.toBeNull();

  await resetEmulators();

  await expect.poll(() => readDocument('cards', 'e2e-card-0501')).toBeNull();
});

test('seed writes exact document IDs and timestamp-backed bodies', async () => {
  const fixedDate = new Date('2026-08-27T00:00:00.000Z');
  await resetEmulators();
  try {
    await seedScenario({
      accountAccess: [{
        uid: 'e2e-seller',
        status: 'suspended',
        confirmedViolationCount: 2,
        suspensionReason: 'Confirmed reason',
        suspendedAt: fixedDate,
        suspendedBy: 'admin-1',
        updatedAt: fixedDate,
      }],
      sellerProfiles: [{
        uid: 'e2e-seller',
        displayName: 'E2E 賣家',
        contactType: 'line',
        contactValue: 'e2e-line',
        createdAt: fixedDate,
        updatedAt: fixedDate,
      }],
      listings: [{
        id: 'e2e-listing',
        sellerId: 'e2e-seller',
        cardId: '0501',
        cardType: 'character',
        cardName: '諸伏高明',
        characterName: '諸伏高明',
        rarity: 'D',
        imageUrls: ['http://example.test/card.png'],
        listingPrice: 500,
        originalQuantity: 5,
        remainingQuantity: 3,
        hasSleeve: true,
        sleeveFee: 20,
        supportsMyShip: true,
        myShipFee: 10,
        note: 'E2E 商品備註',
        status: 'active',
        createdAt: fixedDate,
        updatedAt: fixedDate,
      }],
      sales: [{
        id: 'e2e-sale',
        listingId: 'e2e-listing',
        sellerId: 'e2e-seller',
        cardId: '0501',
        cardType: 'character',
        cardName: '諸伏高明',
        rarity: 'D',
        quantity: 2,
        listingUnitPrice: 500,
        soldUnitPrice: 450,
        soldAt: fixedDate,
      }],
      notificationSubscriptions: [{
        uid: 'e2e-seller',
        cardNames: ['諸伏高明'],
        sellerSubscriptions: [{ sellerId: 'followed-seller', followedAt: fixedDate }],
        emailDailyEnabled: true,
        updatedAt: fixedDate,
      }, {
        uid: 'legacy-buyer',
        cardNames: ['諸伏景光'],
        emailDailyEnabled: true,
        updatedAt: fixedDate,
      }],
      listingEvents: [{
        id: 'new-listing-event', listingId: 'new-listing-event', sellerId: 'followed-seller',
        cardType: 'character', cardName: '諸伏高明', cardId: '0501', rarity: 'D',
        listingPrice: 500, remainingQuantity: 3, createdAt: fixedDate,
        capturedAt: fixedDate, capturedSequence: 7, discordStatus: 'disabled', attempts: 0,
      }, {
        id: 'legacy-listing-event', listingId: 'legacy-listing-event',
        cardType: 'character', cardName: '諸伏景光', cardId: '1096', rarity: 'R',
        listingPrice: 400, remainingQuantity: 1, createdAt: fixedDate,
        capturedAt: fixedDate, capturedSequence: 6, discordStatus: 'disabled', attempts: 0,
      }],
    });

    const profiles = await listDocuments('sellerProfiles');
    expect(profiles).toEqual([{
      id: 'e2e-seller',
      data: {
        displayName: 'E2E 賣家',
        createdAt: Timestamp.fromDate(fixedDate),
        updatedAt: Timestamp.fromDate(fixedDate),
      },
    }]);
    expect(await readDocument('sellerContacts', 'e2e-seller')).toEqual({
      contactType: 'line',
      contactValue: 'e2e-line',
      createdAt: Timestamp.fromDate(fixedDate),
      updatedAt: Timestamp.fromDate(fixedDate),
    });
    expect(await readDocument('accountAccess', 'e2e-seller')).toEqual({
      status: 'suspended',
      confirmedViolationCount: 2,
      suspensionReason: 'Confirmed reason',
      suspendedAt: Timestamp.fromDate(fixedDate),
      suspendedBy: 'admin-1',
      updatedAt: Timestamp.fromDate(fixedDate),
    });
    const listing = await readDocument('listings', 'e2e-listing');
    expect(listing).toMatchObject({
      sellerId: 'e2e-seller',
      createdAt: Timestamp.fromDate(fixedDate),
      updatedAt: Timestamp.fromDate(fixedDate),
    });
    expect(listing).not.toHaveProperty('id');
    expect(await readDocument('sales', 'e2e-sale')).toEqual({
      listingId: 'e2e-listing',
      sellerId: 'e2e-seller',
      cardId: '0501',
      cardType: 'character',
      cardName: '諸伏高明',
      rarity: 'D',
      quantity: 2,
      listingUnitPrice: 500,
      soldUnitPrice: 450,
      soldAt: Timestamp.fromDate(fixedDate),
    });
    expect(await readDocument('notificationSubscriptions', 'e2e-seller')).toEqual({
      cardNames: ['諸伏高明'],
      sellerSubscriptions: [{
        sellerId: 'followed-seller',
        followedAt: Timestamp.fromDate(fixedDate),
      }],
      emailDailyEnabled: true,
      updatedAt: Timestamp.fromDate(fixedDate),
    });
    expect(await readDocument('notificationSubscriptions', 'legacy-buyer')).toEqual({
      cardNames: ['諸伏景光'],
      emailDailyEnabled: true,
      updatedAt: Timestamp.fromDate(fixedDate),
    });
    expect(await readDocument('listingEvents', 'new-listing-event')).toMatchObject({
      sellerId: 'followed-seller',
      capturedAt: Timestamp.fromDate(fixedDate),
      capturedSequence: 7,
    });
    expect(await readDocument('listingEvents', 'legacy-listing-event')).not.toHaveProperty('sellerId');
    await seedScenario({
      moderationReports: [{
        id: 'report-1', status: 'submitted', requestKey: 'a'.repeat(64),
        reporterId: 'buyer-1', targetSellerId: 'e2e-seller',
        listingSnapshot: {
          listingId: 'e2e-listing', cardType: 'character', cardName: '諸伏高明',
          cardId: '0501', rarity: 'D', listingPrice: 500, createdAt: fixedDate,
        },
        createdAt: fixedDate, expiresAt: new Date('2026-08-28T00:00:00Z'),
        category: 'other', description: '說明', evidence: [], submittedAt: fixedDate,
      }],
      moderationReportLimits: [{
        id: 'buyer-1_2026-08-27', reporterId: 'buyer-1', utcDate: '2026-08-27',
        count: 1, createdAt: fixedDate, updatedAt: fixedDate,
      }],
    });
    expect(await readDocument('moderationReports', 'report-1')).toEqual({
      status: 'submitted', requestKey: 'a'.repeat(64), reporterId: 'buyer-1',
      targetSellerId: 'e2e-seller',
      listingSnapshot: {
        listingId: 'e2e-listing', cardType: 'character', cardName: '諸伏高明',
        cardId: '0501', rarity: 'D', listingPrice: 500, createdAt: Timestamp.fromDate(fixedDate),
      },
      createdAt: Timestamp.fromDate(fixedDate),
      expiresAt: Timestamp.fromDate(new Date('2026-08-28T00:00:00Z')),
      category: 'other', description: '說明', evidence: [], submittedAt: Timestamp.fromDate(fixedDate),
    });
    expect(await readDocument('moderationReportLimits', 'buyer-1_2026-08-27'))
      .toMatchObject({ reporterId: 'buyer-1', utcDate: '2026-08-27', count: 1 });
  } finally {
    await resetEmulators();
  }
});

test('image seeding lists the object and reset removes it', async () => {
  const fixturePath = new URL('../fixtures/card-front.png', import.meta.url).pathname;
  await resetEmulators();
  try {
    const url = await seedListingImage('listings/e2e seller/front.png', fixturePath);

    expect(url).toBe(
      `http://127.0.0.1:9199/v0/b/${encodeURIComponent(E2E_BUCKET)}/o/listings%2Fe2e%20seller%2Ffront.png?alt=media&token=e2e-token`,
    );
    await expect.poll(() => listStorageObjects('listings/e2e seller')).toEqual([
      'listings/e2e seller/front.png',
    ]);

    await resetEmulators();

    await expect.poll(() => listStorageObjects('listings/e2e seller')).toEqual([]);
  } finally {
    await resetEmulators();
  }
});

const safeEnvironment = {
  GCLOUD_PROJECT: 'demo-conan-tcg-e2e',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  FIRESTORE_EMULATOR_HOST: 'localhost:8080',
  FIREBASE_STORAGE_EMULATOR_HOST: '[::1]:9199',
};

function withProcessEnvironment(
  overrides: Record<string, string | undefined>,
  run: () => void,
): void {
  const original = Object.fromEntries(
    Object.keys(overrides).map((key) => [key, process.env[key]]),
  );
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    run();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('accepts only the demo project with loopback Emulator hosts', () => {
  expect(() => assertSafeEmulatorEnvironment(safeEnvironment)).not.toThrow();
});

for (const [key, value] of [
  ['FIREBASE_AUTH_EMULATOR_HOST', '127.0.0.1:9100'],
  ['FIRESTORE_EMULATOR_HOST', '127.0.0.1:8081'],
  ['FIREBASE_STORAGE_EMULATOR_HOST', '127.0.0.1:9200'],
] as const) {
  test(`rejects an unexpected ${key} port`, () => {
    expect(() => assertSafeEmulatorEnvironment({
      ...safeEnvironment,
      [key]: value,
    })).toThrow(new RegExp(`Unsafe ${key}`));
  });
}

for (const [name, hostname] of [
  ['IPv4 loopback', '127.0.0.1'],
  ['localhost', 'localhost'],
  ['bracketed IPv6 loopback', '[::1]'],
] as const) {
  test(`accepts canonical ${name} Emulator endpoints`, () => {
    expect(() => assertSafeEmulatorEnvironment({
      GCLOUD_PROJECT: 'demo-conan-tcg-e2e',
      FIREBASE_AUTH_EMULATOR_HOST: `${hostname}:9099`,
      FIRESTORE_EMULATOR_HOST: `${hostname}:8080`,
      FIREBASE_STORAGE_EMULATOR_HOST: `${hostname}:9199`,
      STORAGE_EMULATOR_HOST: `http://${hostname}:9199`,
    })).not.toThrow();
  });
}

for (const [key, value] of [
  ['FIREBASE_AUTH_EMULATOR_HOST', '[::1]@evil.com:9199'],
  ['FIRESTORE_EMULATOR_HOST', '[::1]@evil.com:8080'],
  ['FIREBASE_AUTH_EMULATOR_HOST', 'user@127.0.0.1:9099'],
  ['FIREBASE_AUTH_EMULATOR_HOST', '127.0.0.1:9099/path'],
  ['FIREBASE_AUTH_EMULATOR_HOST', 'localhost:9099?query=1'],
  ['FIREBASE_AUTH_EMULATOR_HOST', '[::1]:9099#fragment'],
  ['FIREBASE_AUTH_EMULATOR_HOST', '127.0.0.1:not-a-port'],
] as const) {
  test(`rejects malformed ${key} endpoint ${value}`, () => {
    expect(() => assertSafeEmulatorEnvironment({
      ...safeEnvironment,
      [key]: value,
    })).toThrow(new RegExp(`Unsafe ${key}`));
  });
}

test('rejects matching Storage overrides that resolve through credentials to a remote host', () => {
  expect(() => assertSafeEmulatorEnvironment({
    ...safeEnvironment,
    FIREBASE_STORAGE_EMULATOR_HOST: '[::1]@evil.com:9199',
    STORAGE_EMULATOR_HOST: 'http://[::1]@evil.com:9199',
  })).toThrow(/Unsafe FIREBASE_STORAGE_EMULATOR_HOST/);
});

test('compares Storage overrides by canonical host and port', () => {
  expect(() => assertSafeEmulatorEnvironment({
    ...safeEnvironment,
    FIREBASE_STORAGE_EMULATOR_HOST: 'localhost:09199',
    STORAGE_EMULATOR_HOST: 'http://LOCALHOST:9199/',
  })).not.toThrow();
});

test('rejects a conflicting Storage SDK Emulator override before client creation', () => {
  withProcessEnvironment({
    ...safeEnvironment,
    STORAGE_EMULATOR_HOST: 'http://10.0.0.1:9199',
  }, () => {
    expect(() => assertSafeEmulatorEnvironment()).toThrow(/Unsafe STORAGE_EMULATOR_HOST/);
  });
});

test('accepts a matching loopback Storage SDK Emulator override', () => {
  withProcessEnvironment({
    ...safeEnvironment,
    FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
    STORAGE_EMULATOR_HOST: 'http://127.0.0.1:9199',
  }, () => {
    expect(() => assertSafeEmulatorEnvironment()).not.toThrow();
  });
});

for (const [name, environment] of [
  ['a production-capable project', { ...safeEnvironment, GCLOUD_PROJECT: 'conan-tcg-market' }],
  ['a missing Emulator host', { ...safeEnvironment, FIRESTORE_EMULATOR_HOST: undefined }],
  ['a non-loopback Emulator host', { ...safeEnvironment, FIREBASE_AUTH_EMULATOR_HOST: '10.0.0.1:9099' }],
] as const) {
  test(`rejects ${name}`, () => {
    expect(() => assertSafeEmulatorEnvironment(environment)).toThrow(/Unsafe/);
  });
}
