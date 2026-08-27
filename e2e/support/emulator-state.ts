import { readFile } from 'node:fs/promises';

import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

import type {
  Card,
  Listing,
  NotificationSubscription,
  Sale,
  SellerProfile,
} from '../../src/domain/models';

export const E2E_PROJECT_ID = 'demo-conan-tcg-e2e';
export const E2E_BUCKET = `${E2E_PROJECT_ID}.appspot.com`;

export interface ScenarioSeed {
  cards?: readonly Card[];
  sellerProfiles?: readonly SellerProfile[];
  listings?: readonly Listing[];
  sales?: readonly Sale[];
  notificationSubscriptions?: readonly NotificationSubscription[];
}

const allowedHosts = new Set(['127.0.0.1', 'localhost', '::1']);

function emulatorHost(value: string | undefined): string | null {
  if (!value) return null;
  if (value.startsWith('[')) {
    const closingBracket = value.indexOf(']');
    return closingBracket === -1 ? null : value.slice(1, closingBracket);
  }
  return value.split(':')[0] || null;
}

export function assertSafeEmulatorEnvironment(
  env: Record<string, string | undefined> = process.env,
): void {
  if (env.GCLOUD_PROJECT !== E2E_PROJECT_ID) {
    throw new Error('Unsafe E2E project.');
  }

  for (const key of [
    'FIREBASE_AUTH_EMULATOR_HOST',
    'FIRESTORE_EMULATOR_HOST',
    'FIREBASE_STORAGE_EMULATOR_HOST',
  ]) {
    if (!allowedHosts.has(emulatorHost(env[key]) ?? '')) {
      throw new Error(`Unsafe ${key}.`);
    }
  }

  const storageSdkHost = env.STORAGE_EMULATOR_HOST;
  if (
    storageSdkHost !== undefined
    && storageSdkHost.replace(/^http:\/\//, '') !== env.FIREBASE_STORAGE_EMULATOR_HOST
  ) {
    throw new Error('Unsafe STORAGE_EMULATOR_HOST.');
  }
}

function adminApp() {
  return getApps().find((app) => app.name === 'e2e-admin')
    ?? initializeApp({ projectId: E2E_PROJECT_ID, storageBucket: E2E_BUCKET }, 'e2e-admin');
}

function adminFirestore() {
  return getFirestore(adminApp());
}

function adminBucket() {
  return getStorage(adminApp()).bucket(E2E_BUCKET);
}

async function requireOk(method: string, url: string): Promise<void> {
  const response = await fetch(url, { method });
  if (!response.ok) {
    throw new Error(`${method} ${url} failed: ${response.status} ${await response.text()}`);
  }
}

export async function resetEmulators(): Promise<void> {
  assertSafeEmulatorEnvironment();
  await requireOk(
    'DELETE',
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${E2E_PROJECT_ID}/accounts`,
  );
  await requireOk(
    'DELETE',
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${E2E_PROJECT_ID}/databases/(default)/documents`,
  );
  await adminBucket().deleteFiles({ force: true });
}

export async function seedScenario(seed: ScenarioSeed): Promise<void> {
  assertSafeEmulatorEnvironment();
  const firestore = adminFirestore();
  const batch = firestore.batch();

  for (const card of seed.cards ?? []) {
    batch.set(firestore.doc(`cards/${card.key}`), {
      cardId: card.cardId,
      cardType: card.cardType,
      cardName: card.cardName,
      rarities: card.rarities,
    });
  }
  for (const profile of seed.sellerProfiles ?? []) {
    batch.set(firestore.doc(`sellerProfiles/${profile.uid}`), {
      displayName: profile.displayName,
      contactType: profile.contactType,
      contactValue: profile.contactValue,
      createdAt: Timestamp.fromDate(profile.createdAt),
      updatedAt: Timestamp.fromDate(profile.updatedAt),
    });
  }
  for (const listing of seed.listings ?? []) {
    batch.set(firestore.doc(`listings/${listing.id}`), {
      sellerId: listing.sellerId,
      cardId: listing.cardId,
      cardType: listing.cardType,
      cardName: listing.cardName,
      ...(listing.characterName ? { characterName: listing.characterName } : {}),
      rarity: listing.rarity,
      imageUrls: listing.imageUrls,
      listingPrice: listing.listingPrice,
      originalQuantity: listing.originalQuantity,
      remainingQuantity: listing.remainingQuantity,
      hasSleeve: listing.hasSleeve,
      ...(listing.sleeveFee === undefined ? {} : { sleeveFee: listing.sleeveFee }),
      supportsMyShip: listing.supportsMyShip,
      ...(listing.myShipFee === undefined ? {} : { myShipFee: listing.myShipFee }),
      ...(listing.note === undefined ? {} : { note: listing.note }),
      status: listing.status,
      createdAt: Timestamp.fromDate(listing.createdAt),
      updatedAt: Timestamp.fromDate(listing.updatedAt),
    });
  }
  for (const record of seed.sales ?? []) {
    batch.set(firestore.doc(`sales/${record.id}`), {
      listingId: record.listingId,
      sellerId: record.sellerId,
      cardId: record.cardId,
      quantity: record.quantity,
      listingUnitPrice: record.listingUnitPrice,
      soldUnitPrice: record.soldUnitPrice,
      soldAt: Timestamp.fromDate(record.soldAt),
    });
  }
  for (const subscription of seed.notificationSubscriptions ?? []) {
    batch.set(firestore.doc(`notificationSubscriptions/${subscription.uid}`), {
      cardNames: subscription.cardNames,
      emailDailyEnabled: subscription.emailDailyEnabled,
      updatedAt: Timestamp.fromDate(subscription.updatedAt),
    });
  }

  await batch.commit();
}

export async function seedListingImage(path: string, fixturePath: string): Promise<string> {
  assertSafeEmulatorEnvironment();
  const bytes = await readFile(fixturePath);
  await adminBucket().file(path).save(bytes, {
    contentType: 'image/png',
    metadata: { firebaseStorageDownloadTokens: 'e2e-token' },
  });
  return `http://127.0.0.1:9199/v0/b/${encodeURIComponent(E2E_BUCKET)}/o/${encodeURIComponent(path)}?alt=media&token=e2e-token`;
}

export async function readDocument(
  collectionName: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  assertSafeEmulatorEnvironment();
  const snapshot = await adminFirestore().doc(`${collectionName}/${id}`).get();
  return snapshot.exists ? snapshot.data() ?? null : null;
}

export async function listDocuments(
  collectionName: string,
): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
  assertSafeEmulatorEnvironment();
  const snapshot = await adminFirestore().collection(collectionName).get();
  return snapshot.docs.map((document) => ({ id: document.id, data: document.data() }));
}

export async function listStorageObjects(prefix: string): Promise<string[]> {
  assertSafeEmulatorEnvironment();
  const [files] = await adminBucket().getFiles({ prefix });
  return files.map((file) => file.name);
}
