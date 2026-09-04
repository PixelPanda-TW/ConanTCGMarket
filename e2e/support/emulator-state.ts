import { readFile } from 'node:fs/promises';

import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

import type {
  AccountAccess,
  Card,
  Listing,
  NotificationSubscription,
  Sale,
  SellerProfile,
} from '../../src/domain/models';

export const E2E_PROJECT_ID = 'demo-conan-tcg-e2e';
export const E2E_BUCKET = `${E2E_PROJECT_ID}.appspot.com`;

export interface ScenarioSeed {
  accountAccess?: readonly AccountAccess[];
  cards?: readonly Card[];
  sellerProfiles?: readonly SellerProfile[];
  listings?: readonly Listing[];
  sales?: readonly Sale[];
  notificationSubscriptions?: readonly NotificationSubscription[];
}

const allowedHosts = new Set(['127.0.0.1', 'localhost', '::1']);

interface EmulatorEndpoint {
  hostname: string;
  port: string;
}

function parseEmulatorEndpoint(
  value: string | undefined,
  allowHttpProtocol = false,
): EmulatorEndpoint | null {
  if (!value) return null;

  const hasProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(value);
  if (hasProtocol && (!allowHttpProtocol || !value.startsWith('http://'))) {
    return null;
  }

  let endpoint: URL;
  try {
    endpoint = new URL(hasProtocol ? value : `http://${value}`);
  } catch {
    return null;
  }

  const hostname = endpoint.hostname.startsWith('[') && endpoint.hostname.endsWith(']')
    ? endpoint.hostname.slice(1, -1)
    : endpoint.hostname;
  if (
    endpoint.protocol !== 'http:'
    || endpoint.username !== ''
    || endpoint.password !== ''
    || (endpoint.pathname !== '' && endpoint.pathname !== '/')
    || endpoint.search !== ''
    || endpoint.hash !== ''
    || !allowedHosts.has(hostname)
    || !/^\d+$/.test(endpoint.port)
    || Number(endpoint.port) < 1
  ) {
    return null;
  }

  return { hostname, port: endpoint.port };
}

export function assertSafeEmulatorEnvironment(
  env: Record<string, string | undefined> = process.env,
): void {
  if (env.GCLOUD_PROJECT !== E2E_PROJECT_ID) {
    throw new Error('Unsafe E2E project.');
  }

  const expectedPorts = new Map([
    ['FIREBASE_AUTH_EMULATOR_HOST', '9099'],
    ['FIRESTORE_EMULATOR_HOST', '8080'],
    ['FIREBASE_STORAGE_EMULATOR_HOST', '9199'],
  ]);
  const firebaseEndpoints = new Map<string, EmulatorEndpoint>();
  for (const [key, expectedPort] of expectedPorts) {
    const endpoint = parseEmulatorEndpoint(env[key]);
    if (!endpoint || endpoint.port !== expectedPort) {
      throw new Error(`Unsafe ${key}.`);
    }
    firebaseEndpoints.set(key, endpoint);
  }

  const storageSdkHost = env.STORAGE_EMULATOR_HOST;
  if (storageSdkHost !== undefined) {
    const storageSdkEndpoint = parseEmulatorEndpoint(storageSdkHost, true);
    const firebaseStorageEndpoint = firebaseEndpoints.get('FIREBASE_STORAGE_EMULATOR_HOST');
    if (
      !storageSdkEndpoint
      || !firebaseStorageEndpoint
      || storageSdkEndpoint.hostname !== firebaseStorageEndpoint.hostname
      || storageSdkEndpoint.port !== firebaseStorageEndpoint.port
    ) {
      throw new Error('Unsafe STORAGE_EMULATOR_HOST.');
    }
  }
}

export function getEmulatorAdminApp() {
  assertSafeEmulatorEnvironment();
  return getApps().find((app) => app.name === 'e2e-admin')
    ?? initializeApp({ projectId: E2E_PROJECT_ID, storageBucket: E2E_BUCKET }, 'e2e-admin');
}

function adminFirestore() {
  return getFirestore(getEmulatorAdminApp());
}

function adminBucket() {
  return getStorage(getEmulatorAdminApp()).bucket(E2E_BUCKET);
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

  for (const access of seed.accountAccess ?? []) {
    batch.set(firestore.doc(`accountAccess/${access.uid}`), access.status === 'suspended'
      ? {
          status: access.status,
          confirmedViolationCount: access.confirmedViolationCount,
          suspensionReason: access.suspensionReason,
          suspendedAt: Timestamp.fromDate(access.suspendedAt),
          suspendedBy: access.suspendedBy,
          updatedAt: Timestamp.fromDate(access.updatedAt),
        }
      : {
          status: access.status,
          confirmedViolationCount: access.confirmedViolationCount,
          updatedAt: Timestamp.fromDate(access.updatedAt),
        });
  }
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
      createdAt: Timestamp.fromDate(profile.createdAt),
      updatedAt: Timestamp.fromDate(profile.updatedAt),
    });
    batch.set(firestore.doc(`sellerContacts/${profile.uid}`), {
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
      ...(record.cardType === undefined ? {} : { cardType: record.cardType }),
      ...(record.cardName === undefined ? {} : { cardName: record.cardName }),
      ...(record.rarity === undefined ? {} : { rarity: record.rarity }),
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

export async function updateListingAvailability(
  listingId: string,
  values: Pick<Listing, 'remainingQuantity' | 'status'>,
): Promise<void> {
  assertSafeEmulatorEnvironment();
  await adminFirestore().doc(`listings/${listingId}`).update(values);
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

export interface EmulatorHttpResult {
  status: number;
  body: unknown;
}

async function responseResult(response: Response): Promise<EmulatorHttpResult> {
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  return { status: response.status, body };
}

export async function getEmulatorUserIdToken(uid: string): Promise<string> {
  assertSafeEmulatorEnvironment();
  const auth = getAuth(getEmulatorAdminApp());
  const user = await auth.getUser(uid);
  if (!user.email) throw new Error('E2E user requires an email.');
  const password = 'E2E-only-password-09';
  await auth.updateUser(uid, { password });
  const response = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=e2e-only`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: user.email, password, returnSecureToken: true }),
    },
  );
  const result = await responseResult(response);
  const idToken = typeof result.body === 'object' && result.body !== null && 'idToken' in result.body
    ? result.body.idToken : null;
  if (!response.ok || typeof idToken !== 'string') {
    throw new Error(`Auth Emulator token request failed: ${result.status}`);
  }
  return idToken;
}

export async function callEmulatorFunctionWithToken(
  idToken: string,
  functionName: string,
  data: Record<string, unknown>,
): Promise<EmulatorHttpResult> {
  assertSafeEmulatorEnvironment();
  if (!/^[A-Za-z][A-Za-z0-9]+$/u.test(functionName)) throw new Error('Unsafe function name.');
  const response = await fetch(
    `http://127.0.0.1:5001/${E2E_PROJECT_ID}/us-central1/${functionName}`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${idToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ data }),
    },
  );
  return responseResult(response);
}

function firestoreValue(value: unknown): Record<string, unknown> {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Unsupported Firestore number.');
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (value instanceof Timestamp) return { timestampValue: value.toDate().toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
  if (typeof value === 'object' && value !== null) {
    return { mapValue: { fields: firestoreFields(value as Record<string, unknown>) } };
  }
  throw new Error('Unsupported Firestore REST value.');
}

function firestoreFields(data: Record<string, unknown>): Record<string, Record<string, unknown>> {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, firestoreValue(value)]));
}

export async function firestoreDocumentRequestAsUser(
  idToken: string,
  method: 'PATCH' | 'DELETE',
  collectionName: string,
  documentId: string,
  data?: Record<string, unknown>,
): Promise<EmulatorHttpResult> {
  assertSafeEmulatorEnvironment();
  if (!/^[A-Za-z][A-Za-z0-9]*$/u.test(collectionName)
    || !/^[A-Za-z0-9_-]+$/u.test(documentId)) throw new Error('Unsafe Firestore path.');
  if (method === 'PATCH' && !data) throw new Error('PATCH requires document data.');
  const response = await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${E2E_PROJECT_ID}/databases/(default)/documents/${collectionName}/${documentId}`,
    {
      method,
      headers: { authorization: `Bearer ${idToken}`, 'content-type': 'application/json' },
      ...(method === 'PATCH' ? { body: JSON.stringify({ fields: firestoreFields(data!) }) } : {}),
    },
  );
  return responseResult(response);
}
