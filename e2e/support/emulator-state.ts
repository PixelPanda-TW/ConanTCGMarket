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
  ModerationReportCategory,
} from '../../src/domain/models';

type NotificationSubscriptionSeed = Omit<NotificationSubscription, 'sellerSubscriptions'> & {
  sellerSubscriptions?: NotificationSubscription['sellerSubscriptions'];
};

export interface ListingEventSeed {
  id: string;
  listingId: string;
  sellerId?: string;
  cardType: 'character' | 'event' | 'case' | 'partner';
  cardName: string;
  cardId: string;
  rarity: string;
  listingPrice: number;
  remainingQuantity: number;
  createdAt: Date;
  capturedAt: Date;
  capturedSequence: number;
  discordStatus: 'disabled' | 'pending' | 'sent' | 'failed';
  attempts: number;
}

export const E2E_PROJECT_ID = 'demo-conan-tcg-e2e';
export const E2E_BUCKET = `${E2E_PROJECT_ID}.appspot.com`;

export interface ScenarioSeed {
  accountAccess?: readonly AccountAccess[];
  cards?: readonly Card[];
  sellerProfiles?: readonly SellerProfile[];
  listings?: readonly Listing[];
  sales?: readonly Sale[];
  notificationSubscriptions?: readonly NotificationSubscriptionSeed[];
  listingEvents?: readonly ListingEventSeed[];
  moderationReports?: readonly ModerationReportSeed[];
  moderationCases?: readonly ModerationCaseSeed[];
  moderationReportLimits?: readonly ModerationReportLimitSeed[];
  accountModerationOperations?: readonly AccountModerationOperationSeed[];
  accountModerationAuditLogs?: readonly AccountModerationAuditSeed[];
}

interface AccountModerationOperationSeedBase {
  actionId: string;
  targetUid: string;
  sourceReportId: string;
  requestedBy: string;
  reason: string;
  requestKey: string;
  confirmedViolationCount: number;
  hiddenListingCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export type AccountModerationOperationSeed =
  | (AccountModerationOperationSeedBase & { status: 'hiding' })
  | (AccountModerationOperationSeedBase & { status: 'suspended'; completedAt: Date })
  | (AccountModerationOperationSeedBase & {
    status: 'restored'; completedAt: Date; restoredAt: Date; restoredBy: string;
    restorationReason: string; restorationRequestKey: string;
  });

interface AccountModerationAuditSeedBase {
  eventId: string;
  targetUid: string;
  suspensionActionId: string;
  sourceReportId: string;
  actorUid: string;
  at: Date;
}

export type AccountModerationAuditSeed =
  | (AccountModerationAuditSeedBase & {
    type: 'suspension_requested'; reason: string; confirmedViolationCount: number;
  })
  | (AccountModerationAuditSeedBase & {
    type: 'suspension_completed'; hiddenListingCount: number;
  })
  | (AccountModerationAuditSeedBase & { type: 'restored'; reason: string })
  | (AccountModerationAuditSeedBase & { type: 'listing_republished'; listingId: string });

interface ModerationCaseSeedBase {
  id: string;
  reportId: string;
  targetSellerId: string;
  openedAt: Date;
}

export type ModerationCaseSeed =
  | (ModerationCaseSeedBase & { status: 'open' })
  | (ModerationCaseSeedBase & {
    status: 'dismissed'; rationale: string; decidedBy: string; decidedAt: Date;
  })
  | (ModerationCaseSeedBase & {
    status: 'confirmed'; rationale: string; decidedBy: string; decidedAt: Date;
    resultingConfirmedViolationCount: number;
  });

export interface ModerationReportSeed {
  id: string;
  status: 'draft' | 'submitted';
  requestKey: string;
  reporterId: string;
  targetSellerId: string;
  listingSnapshot: {
    listingId: string;
    cardType: 'character' | 'event' | 'case' | 'partner';
    cardName: string;
    cardId: string;
    rarity: string;
    listingPrice: number;
    createdAt: Date;
  };
  createdAt: Date;
  expiresAt: Date;
  category?: ModerationReportCategory;
  description?: string;
  evidence?: readonly Record<string, unknown>[];
  submittedAt?: Date;
}

export interface ModerationEvidenceSeed {
  path: string;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  size: number;
  generation: string;
}

export interface ModerationReportLimitSeed {
  id: string;
  reporterId: string;
  utcDate: string;
  count: number;
  createdAt: Date;
  updatedAt: Date;
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

function assertExactSeed(value: object, fields: readonly string[]): void {
  const keys = Object.keys(value);
  if (keys.length !== fields.length || !fields.every((field) => keys.includes(field))) {
    throw new Error('Unsafe account moderation seed.');
  }
  for (const [key, item] of Object.entries(value)) {
    if (key.endsWith('At') && (!(item instanceof Date) || Number.isNaN(item.valueOf()))) {
      throw new Error('Unsafe account moderation seed.');
    }
  }
  for (const key of ['actionId', 'eventId', 'targetUid', 'sourceReportId', 'requestedBy',
    'requestKey', 'suspensionActionId', 'actorUid', 'restoredBy', 'restorationRequestKey',
    'listingId']) {
    if (key in value) {
      const item = (value as Record<string, unknown>)[key];
      if (typeof item !== 'string' || item.length < 1 || item.length > 200
        || item !== item.trim() || !/^[A-Za-z0-9_-]+$/u.test(item)) {
        throw new Error('Unsafe account moderation seed.');
      }
    }
  }
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
          suspensionActionId: access.suspensionActionId,
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
      ...(listing.status === 'suspended' ? {
        suspensionActionId: listing.suspensionActionId,
        suspendedAt: Timestamp.fromDate(listing.suspendedAt),
      } : {}),
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
      ...(subscription.sellerSubscriptions === undefined ? {} : {
        sellerSubscriptions: subscription.sellerSubscriptions.map((entry) => ({
          sellerId: entry.sellerId,
          followedAt: Timestamp.fromDate(entry.followedAt),
        })),
      }),
      emailDailyEnabled: subscription.emailDailyEnabled,
      updatedAt: Timestamp.fromDate(subscription.updatedAt),
    });
  }
  for (const event of seed.listingEvents ?? []) {
    batch.set(firestore.doc(`listingEvents/${event.id}`), {
      id: event.id,
      listingId: event.listingId,
      ...(event.sellerId === undefined ? {} : { sellerId: event.sellerId }),
      cardType: event.cardType,
      cardName: event.cardName,
      cardId: event.cardId,
      rarity: event.rarity,
      listingPrice: event.listingPrice,
      remainingQuantity: event.remainingQuantity,
      createdAt: Timestamp.fromDate(event.createdAt),
      capturedAt: Timestamp.fromDate(event.capturedAt),
      capturedSequence: event.capturedSequence,
      discordStatus: event.discordStatus,
      attempts: event.attempts,
    });
  }
  for (const report of seed.moderationReports ?? []) {
    batch.set(firestore.doc(`moderationReports/${report.id}`), {
      status: report.status,
      requestKey: report.requestKey,
      reporterId: report.reporterId,
      targetSellerId: report.targetSellerId,
      listingSnapshot: {
        ...report.listingSnapshot,
        createdAt: Timestamp.fromDate(report.listingSnapshot.createdAt),
      },
      createdAt: Timestamp.fromDate(report.createdAt),
      expiresAt: Timestamp.fromDate(report.expiresAt),
      ...(report.status === 'submitted' ? {
        category: report.category,
        description: report.description,
        evidence: report.evidence ?? [],
        submittedAt: Timestamp.fromDate(report.submittedAt!),
      } : {}),
    });
  }
  for (const moderationCase of seed.moderationCases ?? []) {
    if (!/^[A-Za-z0-9_-]{1,200}$/u.test(moderationCase.id)
      || moderationCase.reportId !== moderationCase.id
      || typeof moderationCase.targetSellerId !== 'string'
      || moderationCase.targetSellerId.length < 1 || moderationCase.targetSellerId.length > 128
      || !(moderationCase.openedAt instanceof Date)
      || Number.isNaN(moderationCase.openedAt.valueOf())) {
      throw new Error('Unsafe moderation case seed.');
    }
    const common = {
      status: moderationCase.status,
      reportId: moderationCase.reportId,
      targetSellerId: moderationCase.targetSellerId,
      openedAt: Timestamp.fromDate(moderationCase.openedAt),
    };
    if (moderationCase.status === 'open') {
      batch.set(firestore.doc(`moderationCases/${moderationCase.id}`), common);
      continue;
    }
    if (moderationCase.rationale.trim() !== moderationCase.rationale
      || moderationCase.rationale.length < 1 || moderationCase.rationale.length > 1000
      || moderationCase.decidedBy.trim() !== moderationCase.decidedBy
      || moderationCase.decidedBy.length < 1 || moderationCase.decidedBy.length > 128
      || !(moderationCase.decidedAt instanceof Date)
      || Number.isNaN(moderationCase.decidedAt.valueOf())
      || (moderationCase.status === 'confirmed'
        && (!Number.isInteger(moderationCase.resultingConfirmedViolationCount)
          || moderationCase.resultingConfirmedViolationCount < 1))) {
      throw new Error('Unsafe moderation case seed.');
    }
    batch.set(firestore.doc(`moderationCases/${moderationCase.id}`), {
      ...common,
      rationale: moderationCase.rationale,
      decidedBy: moderationCase.decidedBy,
      decidedAt: Timestamp.fromDate(moderationCase.decidedAt),
      ...(moderationCase.status === 'confirmed' ? {
        resultingConfirmedViolationCount: moderationCase.resultingConfirmedViolationCount,
      } : {}),
    });
  }
  for (const limit of seed.moderationReportLimits ?? []) {
    batch.set(firestore.doc(`moderationReportLimits/${limit.id}`), {
      reporterId: limit.reporterId,
      utcDate: limit.utcDate,
      count: limit.count,
      createdAt: Timestamp.fromDate(limit.createdAt),
      updatedAt: Timestamp.fromDate(limit.updatedAt),
    });
  }
  for (const operation of seed.accountModerationOperations ?? []) {
    assertExactSeed(operation, operation.status === 'hiding'
      ? ['actionId', 'status', 'targetUid', 'sourceReportId', 'requestedBy', 'reason', 'requestKey',
        'confirmedViolationCount', 'hiddenListingCount', 'createdAt', 'updatedAt']
      : operation.status === 'suspended'
        ? ['actionId', 'status', 'targetUid', 'sourceReportId', 'requestedBy', 'reason', 'requestKey',
          'confirmedViolationCount', 'hiddenListingCount', 'createdAt', 'updatedAt', 'completedAt']
        : ['actionId', 'status', 'targetUid', 'sourceReportId', 'requestedBy', 'reason', 'requestKey',
          'confirmedViolationCount', 'hiddenListingCount', 'createdAt', 'updatedAt', 'completedAt',
          'restoredAt', 'restoredBy', 'restorationReason', 'restorationRequestKey']);
    batch.set(firestore.doc(`accountModerationOperations/${operation.actionId}`), {
      ...operation,
      createdAt: Timestamp.fromDate(operation.createdAt),
      updatedAt: Timestamp.fromDate(operation.updatedAt),
      ...(operation.status === 'hiding' ? {} : {
        completedAt: Timestamp.fromDate(operation.completedAt),
      }),
      ...(operation.status === 'restored' ? {
        restoredAt: Timestamp.fromDate(operation.restoredAt),
      } : {}),
    });
  }
  for (const audit of seed.accountModerationAuditLogs ?? []) {
    assertExactSeed(audit, audit.type === 'suspension_requested'
      ? ['eventId', 'type', 'targetUid', 'suspensionActionId', 'sourceReportId', 'actorUid', 'at',
        'reason', 'confirmedViolationCount']
      : audit.type === 'suspension_completed'
        ? ['eventId', 'type', 'targetUid', 'suspensionActionId', 'sourceReportId', 'actorUid', 'at',
          'hiddenListingCount']
        : audit.type === 'restored'
          ? ['eventId', 'type', 'targetUid', 'suspensionActionId', 'sourceReportId', 'actorUid', 'at',
            'reason']
          : ['eventId', 'type', 'targetUid', 'suspensionActionId', 'sourceReportId', 'actorUid', 'at',
            'listingId']);
    batch.set(firestore.doc(`accountModerationAuditLogs/${audit.eventId}`), {
      ...audit,
      at: Timestamp.fromDate(audit.at),
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

export async function seedModerationEvidence(
  reporterId: string,
  reportId: string,
  slot: 0 | 1 | 2,
  fixturePath: string,
  contentType: ModerationEvidenceSeed['contentType'] = 'image/png',
): Promise<ModerationEvidenceSeed> {
  assertSafeEmulatorEnvironment();
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(reporterId)
    || !/^[A-Za-z0-9_-]{1,200}$/u.test(reportId)
    || !Number.isInteger(slot) || slot < 0 || slot > 2
    || !['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
    throw new Error('Unsafe moderation evidence seed.');
  }
  const bytes = await readFile(fixturePath);
  if (bytes.length < 1 || bytes.length > 5 * 1024 * 1024) {
    throw new Error('Unsafe moderation evidence seed.');
  }
  const path = `reportEvidence/${reporterId}/${reportId}/${slot}`;
  const file = adminBucket().file(path);
  await file.save(bytes, { contentType });
  const [metadata] = await file.getMetadata();
  if (typeof metadata.generation !== 'string' || !/^\d+$/u.test(metadata.generation)
    || Number(metadata.size) !== bytes.length || metadata.contentType !== contentType) {
    throw new Error('Invalid moderation evidence seed metadata.');
  }
  return { path, contentType, size: bytes.length, generation: metadata.generation };
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
  maximum = 100,
): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
  assertSafeEmulatorEnvironment();
  if (!/^[A-Za-z][A-Za-z0-9]*$/u.test(collectionName)
    || !Number.isSafeInteger(maximum) || maximum < 1 || maximum > 100) {
    throw new Error('Unsafe bounded document list.');
  }
  const snapshot = await adminFirestore().collection(collectionName).limit(maximum).get();
  return snapshot.docs.map((document) => ({ id: document.id, data: document.data() }));
}

export async function listStorageObjects(prefix: string): Promise<string[]> {
  assertSafeEmulatorEnvironment();
  const [files] = await adminBucket().getFiles({ prefix });
  return files.map((file) => file.name);
}

export async function readStorageObjectMetadata(path: string): Promise<Record<string, unknown> | null> {
  assertSafeEmulatorEnvironment();
  try {
    const [metadata] = await adminBucket().file(path).getMetadata();
    return metadata as unknown as Record<string, unknown>;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error
      && (error.code === 404 || error.code === '404')) return null;
    throw error;
  }
}

export async function uploadStorageObjectAsUser(
  idToken: string,
  path: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<EmulatorHttpResult> {
  assertSafeEmulatorEnvironment();
  if (!path.startsWith('reportEvidence/') || path.includes('..')) {
    throw new Error('Unsafe report evidence path.');
  }
  const response = await fetch(
    `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${encodeURIComponent(E2E_BUCKET)}/o?uploadType=media&name=${encodeURIComponent(path)}`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${idToken}`, 'content-type': contentType },
      body: bytes,
    },
  );
  return responseResult(response);
}

export async function readModerationStorageObjectAsUser(
  idToken: string,
  path: string,
): Promise<EmulatorHttpResult> {
  assertSafeEmulatorEnvironment();
  if (!/^reportEvidence\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,200}\/[0-2]$/u.test(path)) {
    throw new Error('Unsafe moderation evidence read path.');
  }
  const response = await fetch(
    `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${encodeURIComponent(E2E_BUCKET)}/o/${encodeURIComponent(path)}?alt=media`,
    { headers: { authorization: `Bearer ${idToken}` } },
  );
  return responseResult(response);
}

export async function readAppealStorageObjectAsUser(
  idToken: string,
  path: string,
): Promise<EmulatorHttpResult> {
  assertSafeEmulatorEnvironment();
  if (!/^account-appeal-evidence\/[^/]{1,128}\/[A-Za-z0-9_-]{1,200}\/[0-9a-f-]{36}\/[0-2]$/iu.test(path)) {
    throw new Error('Unsafe account appeal evidence read path.');
  }
  const response = await fetch(
    `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${encodeURIComponent(E2E_BUCKET)}/o/${encodeURIComponent(path)}?alt=media`,
    { headers: { authorization: `Bearer ${idToken}` } },
  );
  return responseResult(response);
}

export async function uploadAppealStorageObjectAsUser(
  idToken: string,
  path: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<EmulatorHttpResult> {
  assertSafeEmulatorEnvironment();
  if (!/^account-appeal-evidence\/[^/]{1,128}\/[A-Za-z0-9_-]{1,200}\/[0-9a-f-]{36}\/[0-2]$/iu.test(path)) {
    throw new Error('Unsafe account appeal evidence write path.');
  }
  const response = await fetch(
    `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${encodeURIComponent(E2E_BUCKET)}/o?uploadType=media&name=${encodeURIComponent(path)}`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${idToken}`, 'content-type': contentType },
      body: bytes,
    },
  );
  return responseResult(response);
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

export async function invokeAccountModerationReconciler(): Promise<EmulatorHttpResult> {
  assertSafeEmulatorEnvironment();
  if (!getApps().some(({ name }) => name === '[DEFAULT]')) {
    initializeApp({ projectId: E2E_PROJECT_ID, storageBucket: E2E_BUCKET });
  }
  const deployed = await import('../../functions/lib/index.js');
  await deployed.reconcileAccountModerationOperations.run({
    scheduleTime: new Date().toISOString(),
  });
  return { status: 200, body: { invoked: true } };
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
  method: 'GET' | 'PATCH' | 'DELETE',
  collectionName: string,
  documentId: string,
  data?: Record<string, unknown>,
): Promise<EmulatorHttpResult> {
  assertSafeEmulatorEnvironment();
  if (!/^[A-Za-z][A-Za-z0-9]*$/u.test(collectionName)
    || !/^[A-Za-z0-9_-]+$/u.test(documentId)) throw new Error('Unsafe Firestore path.');
  if (method === 'PATCH' && !data) throw new Error('PATCH requires document data.');
  if (method !== 'PATCH' && data !== undefined) throw new Error(`${method} forbids document data.`);
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
