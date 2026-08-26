import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  aggregateCardMasterRecords,
  canonicalCardIdentity,
  createCardKey,
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

export function planCardMasterImport(input, { createKey = createCardKey } = {}) {
  const cards = validateCardMasterImport(input);
  const prepared = cards.map((card) => ({ key: createKey(card), ...card }));
  assertNoKeyCollisions(prepared);
  return Array.from({ length: Math.ceil(prepared.length / MAX_WRITES_PER_BATCH) }, (_, index) => (
    prepared.slice(index * MAX_WRITES_PER_BATCH, (index + 1) * MAX_WRITES_PER_BATCH)
  ));
}

export async function executeCardMasterImport(
  input,
  { initializeFirestore = initializeAdminFirestore, createKey = createCardKey } = {},
) {
  const plan = planCardMasterImport(input, { createKey });
  const db = await initializeFirestore();

  for (const cards of plan) {
    const batch = db.batch();
    for (const { key, cardId, cardType, cardName, rarities } of cards) {
      batch.set(db.collection('cards').doc(key), { cardId, cardType, cardName, rarities });
    }
    await batch.commit();
  }
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
  if (!dryRun) return executeImport(input);

  const batches = planCardMasterImport(input);
  const recordCount = batches.reduce((count, batch) => count + batch.length, 0);
  log(`records=${recordCount}, batches=${batches.length}, keyCollisions=0`);
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
