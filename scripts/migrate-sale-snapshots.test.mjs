import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Timestamp } from 'firebase-admin/firestore';
import { afterEach, test } from 'node:test';
import {
  SaleSnapshotMigrationError,
  planSaleSnapshotMigration,
  runSaleSnapshotMigration,
  writeJsonBackup,
} from './migrate-sale-snapshots.mjs';

const soldAt = new Date('2026-09-01T04:05:06.000Z');
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function legacySale(id = 'sale-1', overrides = {}) {
  return {
    id,
    data: {
      cardId: '0501',
      listingId: 'listing-1',
      listingUnitPrice: 120,
      quantity: 2,
      sellerId: 'seller-1',
      soldAt,
      soldUnitPrice: 100,
      ...overrides,
    },
  };
}

function currentSale(id = 'sale-1', overrides = {}) {
  return {
    id,
    data: {
      ...legacySale(id).data,
      cardType: 'event',
      cardName: '追跡開始',
      rarity: 'C',
      ...overrides,
    },
  };
}

function canonicalListing(id = 'listing-1', overrides = {}) {
  return {
    id,
    data: {
      sellerId: 'seller-1',
      cardId: '0501',
      cardType: 'event',
      cardName: '追跡開始',
      rarity: 'C',
      ...overrides,
    },
  };
}

function memoryDependencies({ sales = [legacySale()], listings = [canonicalListing()], verifyOverride } = {}) {
  const state = { sales: structuredClone(sales), listings: structuredClone(listings) };
  const events = [];
  return {
    state,
    events,
    dependencies: {
      listSales: async () => structuredClone(state.sales),
      listListings: async () => structuredClone(state.listings),
      backupExists: async () => false,
      writeBackup: async (_path, payload) => { events.push(['backup', structuredClone(payload)]); },
      writeSaleSnapshotBatch: async (records) => {
        events.push(['sales', records.map((record) => record.id)]);
        for (const record of records) {
          const found = state.sales.find((sale) => sale.id === record.id);
          Object.assign(found.data, structuredClone(record.data));
        }
      },
      readSales: async (ids) => verifyOverride ?? structuredClone(
        state.sales.filter((record) => ids.includes(record.id)),
      ),
    },
  };
}

test('plans an immutable snapshot backfill only from the referenced canonical Listing', () => {
  assert.deepEqual(planSaleSnapshotMigration([legacySale()], [canonicalListing()]), {
    sourceCount: 1,
    normalizedCount: 0,
    legacyCount: 1,
    backfillWrites: [{
      id: 'sale-1',
      data: { cardType: 'event', cardName: '追跡開始', rarity: 'C' },
    }],
    unresolved: [],
  });
});

test('accepts complete current Sales and Admin Timestamp values without rewriting them', () => {
  const sale = currentSale('sale-current', { soldAt: Timestamp.fromDate(soldAt) });
  assert.deepEqual(planSaleSnapshotMigration([sale], [canonicalListing()]), {
    sourceCount: 1,
    normalizedCount: 1,
    legacyCount: 0,
    backfillWrites: [],
    unresolved: [],
  });
});

test('reports missing and noncanonical Listings without guessing from Card Master data', () => {
  const missing = legacySale('missing', { listingId: 'listing-missing' });
  const ambiguous = legacySale('ambiguous', { listingId: 'listing-legacy' });
  const plan = planSaleSnapshotMigration([missing, ambiguous], [{
    id: 'listing-legacy', data: { sellerId: 'seller-1', cardId: '0501', characterName: '舊資料', rarity: 'R' },
  }]);
  assert.deepEqual(plan.unresolved, [
    { saleId: 'missing', reason: 'missing-listing' },
    { saleId: 'ambiguous', reason: 'listing-metadata-unavailable' },
  ]);
  assert.deepEqual(plan.backfillWrites, []);
});

test('malformed Sales and partial snapshots abort before any write', async () => {
  for (const sale of [
    legacySale('bad-price', { soldUnitPrice: 0 }),
    legacySale('extra', { effect: 'must never be migrated' }),
    legacySale('partial', { cardType: 'event' }),
  ]) {
    const { dependencies, events } = memoryDependencies({ sales: [sale] });
    await assert.rejects(
      runSaleSnapshotMigration({ projectId: 'demo-project' }, dependencies),
      SaleSnapshotMigrationError,
    );
    assert.deepEqual(events, []);
  }
});

test('Sale and Listing identity or snapshot conflicts abort instead of rewriting history', () => {
  assert.throws(
    () => planSaleSnapshotMigration([legacySale()], [canonicalListing('listing-1', { sellerId: 'other' })]),
    /sellerId conflicts/,
  );
  assert.throws(
    () => planSaleSnapshotMigration([legacySale()], [canonicalListing('listing-1', { cardId: '0590' })]),
    /cardId conflicts/,
  );
  assert.throws(
    () => planSaleSnapshotMigration([currentSale()], [canonicalListing('listing-1', { cardName: '不同名稱' })]),
    /snapshot conflicts/,
  );
});

test('default dry-run validates and reports but never backs up or writes', async () => {
  const { dependencies, events } = memoryDependencies();
  const result = await runSaleSnapshotMigration({ projectId: 'demo-project' }, dependencies);
  assert.deepEqual(result, {
    mode: 'dry-run', sourceCount: 1, normalizedCount: 0, legacyCount: 1,
    backfillWriteCount: 1, unresolvedCount: 0, unresolved: [],
  });
  assert.deepEqual(events, []);
});

test('apply requires an explicit project, backup, and fully resolvable source data', async () => {
  const { dependencies } = memoryDependencies();
  await assert.rejects(
    runSaleSnapshotMigration({ apply: true, backupPath: '/tmp/sales.json' }, dependencies),
    /explicit project ID/,
  );
  await assert.rejects(
    runSaleSnapshotMigration({ apply: true, projectId: 'production' }, dependencies),
    /backup path/,
  );
  await assert.rejects(
    runSaleSnapshotMigration({ apply: true, projectId: 'production', backupPath: '/tmp/sales.json' }, {
      ...dependencies, backupExists: async () => true,
    }),
    /already exists/,
  );
  const unresolved = memoryDependencies({ listings: [] });
  await assert.rejects(
    runSaleSnapshotMigration({ apply: true, projectId: 'production', backupPath: '/tmp/sales.json' }, unresolved.dependencies),
    /unresolved Sales/,
  );
  assert.deepEqual(unresolved.events, []);
});

test('apply backs up the complete source, batches merge-only writes, and verifies every result', async () => {
  const sales = Array.from({ length: 805 }, (_, index) => legacySale(`sale-${index}`, {
    listingId: `listing-${index}`,
  }));
  const listings = Array.from({ length: 805 }, (_, index) => canonicalListing(`listing-${index}`));
  const { dependencies, events, state } = memoryDependencies({ sales, listings });
  const readSales = dependencies.readSales;
  const readSizes = [];
  dependencies.readSales = async (ids) => { readSizes.push(ids.length); return readSales(ids); };

  const result = await runSaleSnapshotMigration({
    apply: true, projectId: 'production-looking-id', backupPath: '/tmp/not-written.json', batchSize: 400,
  }, dependencies);

  assert.equal(result.mode, 'apply');
  assert.deepEqual(events.map(([event]) => event), ['backup', 'sales', 'sales', 'sales']);
  assert.equal(events[0][1].sales.length, 805);
  assert.equal(events[0][1].listings.length, 805);
  assert.deepEqual(events.slice(1).map(([, ids]) => ids.length), [400, 400, 5]);
  assert.deepEqual(readSizes, [400, 400, 5]);
  assert.equal(state.sales[0].data.cardName, '追跡開始');
});

test('verification mismatch fails instead of claiming a successful migration', async () => {
  const { dependencies, events } = memoryDependencies({ verifyOverride: [] });
  await assert.rejects(runSaleSnapshotMigration({
    apply: true, projectId: 'demo-project', backupPath: '/tmp/mismatch.json',
  }, dependencies), /verification failed/);
  assert.deepEqual(events.map(([event]) => event), ['backup', 'sales']);
});

test('rejects unsafe batch sizes and treats a completed apply as a write-free no-op', async () => {
  const invalid = memoryDependencies();
  await assert.rejects(runSaleSnapshotMigration({ batchSize: 401 }, invalid.dependencies), /1 to 400/);
  const complete = memoryDependencies({ sales: [currentSale()] });
  const result = await runSaleSnapshotMigration({
    apply: true, projectId: 'demo-project', backupPath: '/tmp/noop.json',
  }, complete.dependencies);
  assert.equal(result.backfillWriteCount, 0);
  assert.deepEqual(complete.events, []);
});

test('filesystem backup preserves Admin Timestamp data and refuses overwrite', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sale-snapshot-migration-'));
  temporaryDirectories.push(directory);
  const backupPath = join(directory, 'backup.json');
  const timestamp = Timestamp.fromDate(soldAt);
  await writeJsonBackup(backupPath, { sales: [legacySale('timestamp', { soldAt: timestamp })] });
  const parsed = JSON.parse(await readFile(backupPath, 'utf8'));
  assert.equal(parsed.sales[0].data.soldAt._seconds, timestamp.seconds);
  assert.equal(parsed.sales[0].data.soldAt._nanoseconds, timestamp.nanoseconds);
  await assert.rejects(writeJsonBackup(backupPath, {}), /already exists/);
});
