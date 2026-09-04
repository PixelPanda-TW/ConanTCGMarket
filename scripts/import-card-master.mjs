import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  aggregateCardMasterRecords,
  canonicalCardIdentity,
  createCardKey,
  validateCardMasterArchives,
} from './card-master-domain.mjs';

const MAX_WRITES_PER_BATCH = 450;

export function validateCardMasterImport(input) {
  try {
    return aggregateCardMasterRecords(input);
  } catch {
    throw new Error('Invalid card master input.');
  }
}

function assertNoKeyCollisions(prepared) {
  const identityByKey = new Map();
  for (const card of prepared) {
    const identity = canonicalCardIdentity(card);
    const previousIdentity = identityByKey.get(card.key);
    if (previousIdentity !== undefined && previousIdentity !== identity) {
      throw new Error(`Card key collision: ${card.key}.`);
    }
    identityByKey.set(card.key, identity);
  }
}

export function planCardMasterImport(
  input,
  { createKey = createCardKey, suppressedKeys = [] } = {},
) {
  const cards = validateCardMasterImport(input);
  const prepared = cards.map((card) => ({ key: createKey(card), ...card }));
  assertNoKeyCollisions(prepared);
  if (!Array.isArray(suppressedKeys) || new Set(suppressedKeys).size !== suppressedKeys.length
    || suppressedKeys.some((key) => typeof key !== 'string')) {
    throw new Error('Invalid suppressed Card Master keys.');
  }
  const suppression = new Set(suppressedKeys);
  const matchedSuppressedKeys = prepared
    .filter(({ key }) => suppression.has(key))
    .map(({ key }) => key)
    .sort();
  const writable = prepared.filter(({ key }) => !suppression.has(key));
  const batches = Array.from(
    { length: Math.ceil(writable.length / MAX_WRITES_PER_BATCH) },
    (_, index) => writable.slice(index * MAX_WRITES_PER_BATCH, (index + 1) * MAX_WRITES_PER_BATCH),
  );
  return {
    batches,
    suppressedKeys: matchedSuppressedKeys,
    suppressedCount: matchedSuppressedKeys.length,
  };
}

async function listCardMasterArchives(db) {
  const snapshot = await db.collection('cardMasterArchives').get();
  return snapshot.docs.map((document) => {
    const data = document.data();
    const actedAt = data.actedAt && typeof data.actedAt.toDate === 'function'
      ? data.actedAt.toDate()
      : data.actedAt;
    return { key: document.id, ...data, actedAt };
  });
}

export async function executeCardMasterImport(
  input,
  {
    initializeFirestore = initializeAdminFirestore,
    createKey = createCardKey,
    listArchives = listCardMasterArchives,
    dryRun = false,
  } = {},
) {
  planCardMasterImport(input, { createKey });
  const db = await initializeFirestore();
  const suppressedKeys = validateCardMasterArchives(await listArchives(db));
  const plan = planCardMasterImport(input, { createKey, suppressedKeys });

  if (dryRun) return plan;

  for (const cards of plan.batches) {
    const batch = db.batch();
    for (const { key, cardId, cardType, cardName, rarities } of cards) {
      batch.set(db.collection('cards').doc(key), { cardId, cardType, cardName, rarities });
    }
    await batch.commit();
  }
  return plan;
}

export async function runCardMasterImportCli(
  argv,
  {
    readJson = async (path) => JSON.parse(await readFile(path, 'utf8')),
    executeImport = executeCardMasterImport,
    log = console.log,
  } = {},
) {
  const dryRun = argv[0] === '--dry-run';
  const inputPath = dryRun ? argv[1] : argv[0];
  if (!inputPath) throw new Error('Usage: npm run import:cards -- [--dry-run] <input-file>');

  const input = await readJson(inputPath);
  const result = await executeImport(input, { dryRun });
  if (!dryRun) return result;

  const { batches, suppressedCount, suppressedKeys } = result;
  const recordCount = batches.reduce((count, batch) => count + batch.length, 0);
  log(`records=${recordCount}, batches=${batches.length}, keyCollisions=0, suppressedCount=${suppressedCount}`);
  if (suppressedKeys.length > 0) log(`suppressedKeys=${suppressedKeys.join(',')}`);
}

async function initializeAdminFirestore() {
  const [{ getApps, initializeApp }, { getFirestore }] = await Promise.all([
    import('firebase-admin/app'),
    import('firebase-admin/firestore'),
  ]);
  if (getApps().length === 0) initializeApp();
  return getFirestore();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runCardMasterImportCli(process.argv.slice(2));
}
