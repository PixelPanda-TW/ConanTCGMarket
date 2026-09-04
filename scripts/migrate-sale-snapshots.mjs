import { open, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const DEFAULT_BATCH_SIZE = 400;
const LEGACY_FIELDS = [
  'cardId', 'listingId', 'listingUnitPrice', 'quantity', 'sellerId', 'soldAt', 'soldUnitPrice',
];
const SNAPSHOT_FIELDS = ['cardName', 'cardType', 'rarity'];
const CURRENT_FIELDS = [...LEGACY_FIELDS, ...SNAPSHOT_FIELDS].sort();
const CARD_TYPES = new Set(['character', 'event', 'case', 'partner']);

export class SaleSnapshotMigrationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SaleSnapshotMigrationError';
  }
}

function exactFields(data, expected) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const fields = Object.keys(data).sort();
  const sortedExpected = [...expected].sort();
  return fields.length === sortedExpected.length
    && fields.every((field, index) => field === sortedExpected[index]);
}

function validateDocumentId(id, label) {
  if (typeof id !== 'string' || id.length < 1 || id.length > 128 || id.trim() !== id) {
    throw new SaleSnapshotMigrationError(`${label} has an invalid document ID.`);
  }
}

function asDate(value, field, id) {
  const date = value instanceof Date ? value : value?.toDate?.();
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) {
    throw new SaleSnapshotMigrationError(`${id} has an invalid ${field}.`);
  }
  return date;
}

function text(value, maximum = 200) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum && value.trim() === value;
}

function readSaleBase(id, data) {
  if (!text(data.cardId, 40) || !text(data.listingId, 128) || !text(data.sellerId, 128)
    || !Number.isFinite(data.listingUnitPrice) || data.listingUnitPrice <= 0
    || !Number.isFinite(data.soldUnitPrice) || data.soldUnitPrice <= 0
    || !Number.isInteger(data.quantity) || data.quantity < 1) {
    throw new SaleSnapshotMigrationError(`${id} has malformed Sale data.`);
  }
  asDate(data.soldAt, 'soldAt', id);
  return data;
}

function readSnapshot(id, data, label) {
  if (!CARD_TYPES.has(data.cardType) || !text(data.cardName) || !text(data.rarity, 40)) {
    throw new SaleSnapshotMigrationError(`${id} has unavailable ${label} snapshot metadata.`);
  }
  return { cardType: data.cardType, cardName: data.cardName, rarity: data.rarity };
}

function recordsById(records, label) {
  const map = new Map();
  for (const record of records) {
    validateDocumentId(record.id, label);
    if (map.has(record.id)) throw new SaleSnapshotMigrationError(`Duplicate ${label} ${record.id}.`);
    map.set(record.id, record.data);
  }
  return map;
}

function sameSnapshot(left, right) {
  return SNAPSHOT_FIELDS.every((field) => left[field] === right[field]);
}

function readCanonicalListingSnapshot(saleId, sale, listing) {
  if (!listing || typeof listing !== 'object' || Array.isArray(listing)) return null;
  if (!text(listing.sellerId, 128) || !text(listing.cardId, 40)) return null;
  if (listing.sellerId !== sale.sellerId) {
    throw new SaleSnapshotMigrationError(`${saleId} sellerId conflicts with its Listing.`);
  }
  if (listing.cardId !== sale.cardId) {
    throw new SaleSnapshotMigrationError(`${saleId} cardId conflicts with its Listing.`);
  }
  try {
    return readSnapshot(saleId, listing, 'Listing');
  } catch (error) {
    if (error instanceof SaleSnapshotMigrationError) return null;
    throw error;
  }
}

export function planSaleSnapshotMigration(sales, listings) {
  const listingMap = recordsById(listings, 'Listing');
  const saleIds = new Set();
  const backfillWrites = [];
  const unresolved = [];
  let normalizedCount = 0;
  let legacyCount = 0;

  for (const record of sales) {
    validateDocumentId(record.id, 'Sale');
    if (saleIds.has(record.id)) throw new SaleSnapshotMigrationError(`Duplicate Sale ${record.id}.`);
    saleIds.add(record.id);
    const isLegacy = exactFields(record.data, LEGACY_FIELDS);
    const isCurrent = exactFields(record.data, CURRENT_FIELDS);
    if (!isLegacy && !isCurrent) {
      throw new SaleSnapshotMigrationError(`${record.id} has unsupported, partial, or extra Sale fields.`);
    }
    const sale = readSaleBase(record.id, record.data);
    const listing = listingMap.get(sale.listingId);

    if (isCurrent) {
      normalizedCount += 1;
      const snapshot = readSnapshot(record.id, sale, 'Sale');
      if (listing !== undefined) {
        const listingSnapshot = readCanonicalListingSnapshot(record.id, sale, listing);
        if (listingSnapshot && !sameSnapshot(snapshot, listingSnapshot)) {
          throw new SaleSnapshotMigrationError(`${record.id} snapshot conflicts with its Listing.`);
        }
      }
      continue;
    }

    legacyCount += 1;
    if (listing === undefined) {
      unresolved.push({ saleId: record.id, reason: 'missing-listing' });
      continue;
    }
    const snapshot = readCanonicalListingSnapshot(record.id, sale, listing);
    if (!snapshot) {
      unresolved.push({ saleId: record.id, reason: 'listing-metadata-unavailable' });
      continue;
    }
    backfillWrites.push({ id: record.id, data: snapshot });
  }

  return { sourceCount: sales.length, normalizedCount, legacyCount, backfillWrites, unresolved };
}

function chunks(records, size) {
  const result = [];
  for (let index = 0; index < records.length; index += size) result.push(records.slice(index, index + size));
  return result;
}

function valuesMatch(expected, actual) {
  if (expected instanceof Date || typeof expected?.toDate === 'function') {
    try { return asDate(expected, 'value', 'expected').valueOf() === asDate(actual, 'value', 'actual').valueOf(); }
    catch { return false; }
  }
  return expected === actual;
}

function verifySales(expectedRecords, actualRecords) {
  if (expectedRecords.length !== actualRecords.length) return false;
  const actualMap = new Map(actualRecords.map((record) => [record.id, record.data]));
  return expectedRecords.every((record) => {
    const actual = actualMap.get(record.id);
    if (!actual || !exactFields(actual, CURRENT_FIELDS)) return false;
    return CURRENT_FIELDS.every((field) => valuesMatch(record.data[field], actual[field]));
  });
}

export async function runSaleSnapshotMigration(options, dependencies) {
  const apply = options.apply === true;
  if (apply && (typeof options.projectId !== 'string' || !options.projectId.trim())) {
    throw new Error('Apply mode requires an explicit project ID.');
  }
  if (apply && (typeof options.backupPath !== 'string' || !options.backupPath.trim())) {
    throw new Error('Apply mode requires an explicit backup path.');
  }
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 400) {
    throw new Error('Batch size must be an integer from 1 to 400.');
  }

  const [sales, listings] = await Promise.all([dependencies.listSales(), dependencies.listListings()]);
  const plan = planSaleSnapshotMigration(sales, listings);
  const result = {
    mode: apply ? 'apply' : 'dry-run',
    sourceCount: plan.sourceCount,
    normalizedCount: plan.normalizedCount,
    legacyCount: plan.legacyCount,
    backfillWriteCount: plan.backfillWrites.length,
    unresolvedCount: plan.unresolved.length,
    unresolved: plan.unresolved,
  };
  if (!apply || plan.backfillWrites.length === 0 && plan.unresolved.length === 0) return result;
  if (plan.unresolved.length > 0) {
    throw new Error(`Apply mode refused ${plan.unresolved.length} unresolved Sales.`);
  }
  if (await dependencies.backupExists(options.backupPath)) {
    throw new Error(`Backup path already exists: ${options.backupPath}`);
  }
  await dependencies.writeBackup(options.backupPath, {
    projectId: options.projectId,
    createdAt: new Date().toISOString(),
    sales,
    listings,
  });
  for (const batch of chunks(plan.backfillWrites, batchSize)) {
    await dependencies.writeSaleSnapshotBatch(batch);
  }

  const sourceMap = new Map(sales.map((record) => [record.id, record.data]));
  const expected = plan.backfillWrites.map((record) => ({
    id: record.id,
    data: { ...sourceMap.get(record.id), ...record.data },
  }));
  const verified = [];
  for (const idBatch of chunks(expected.map((record) => record.id), batchSize)) {
    verified.push(...await dependencies.readSales(idBatch));
  }
  if (!verifySales(expected, verified)) throw new Error('Sale snapshot verification failed.');
  return result;
}

export async function writeJsonBackup(path, payload) {
  let handle;
  try {
    handle = await open(path, 'wx');
    await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error(`Backup path already exists: ${path}`);
    throw error;
  } finally {
    await handle?.close();
  }
}

async function pathExists(path) {
  try { await stat(path); return true; } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function parseArguments(argv) {
  const options = { apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--apply') options.apply = true;
    else if (argument === '--project') options.projectId = argv[++index];
    else if (argument === '--backup') options.backupPath = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.projectId) throw new Error('Pass --project with an explicit Firebase project ID.');
  return options;
}

async function runCli() {
  const options = parseArguments(process.argv.slice(2));
  const app = getApps().find((candidate) => candidate.name === 'sale-snapshot-migration')
    ?? initializeApp({ projectId: options.projectId }, 'sale-snapshot-migration');
  const firestore = getFirestore(app);
  const dependencies = {
    listSales: async () => (await firestore.collection('sales').get()).docs
      .map((document) => ({ id: document.id, data: document.data() })),
    listListings: async () => (await firestore.collection('listings').get()).docs
      .map((document) => ({ id: document.id, data: document.data() })),
    backupExists: pathExists,
    writeBackup: writeJsonBackup,
    async writeSaleSnapshotBatch(records) {
      const batch = firestore.batch();
      for (const record of records) batch.update(firestore.collection('sales').doc(record.id), record.data);
      await batch.commit();
    },
    async readSales(ids) {
      if (ids.length === 0) return [];
      const snapshots = await firestore.getAll(...ids.map((id) => firestore.collection('sales').doc(id)));
      return snapshots.filter((snapshot) => snapshot.exists)
        .map((snapshot) => ({ id: snapshot.id, data: snapshot.data() }));
    },
  };
  const result = await runSaleSnapshotMigration(options, dependencies);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
