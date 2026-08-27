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
        quantity: 2,
        listingUnitPrice: 500,
        soldUnitPrice: 450,
        soldAt: fixedDate,
      }],
      notificationSubscriptions: [{
        uid: 'e2e-seller',
        cardNames: ['諸伏高明'],
        emailDailyEnabled: true,
        updatedAt: fixedDate,
      }],
    });

    const profiles = await listDocuments('sellerProfiles');
    expect(profiles).toEqual([{
      id: 'e2e-seller',
      data: {
        displayName: 'E2E 賣家',
        contactType: 'line',
        contactValue: 'e2e-line',
        createdAt: Timestamp.fromDate(fixedDate),
        updatedAt: Timestamp.fromDate(fixedDate),
      },
    }]);
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
      quantity: 2,
      listingUnitPrice: 500,
      soldUnitPrice: 450,
      soldAt: Timestamp.fromDate(fixedDate),
    });
    expect(await readDocument('notificationSubscriptions', 'e2e-seller')).toEqual({
      cardNames: ['諸伏高明'],
      emailDailyEnabled: true,
      updatedAt: Timestamp.fromDate(fixedDate),
    });
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
