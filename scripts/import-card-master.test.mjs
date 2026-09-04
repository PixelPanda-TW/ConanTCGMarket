import test from 'node:test';
import assert from 'node:assert/strict';
import * as cardMasterImporter from './import-card-master.mjs';

const {
  executeCardMasterImport,
  planCardMasterImport,
  validateCardMasterImport,
} = cardMasterImporter;

test('CLI import validation normalizes and preserves distinct composite identities sharing a visible ID', () => {
  assert.deepEqual(
    validateCardMasterImport([
      { cardId: '0501', cardType: 'character', cardName: '諸伏高明', rarities: ['d'] },
      { cardId: '0501', cardType: 'event', cardName: '事件 0501', rarities: ['D'] },
      { cardId: 'p001', cardType: 'partner', cardName: '江戶川柯南', rarities: ['p'] },
    ]),
    [
      { cardId: '0501', cardType: 'character', cardName: '諸伏高明', rarities: ['D'] },
      { cardId: '0501', cardType: 'event', cardName: '事件 0501', rarities: ['D'] },
      { cardId: 'P001', cardType: 'partner', cardName: '江戶川柯南', rarities: ['P'] },
    ],
  );
});

test('CLI import validation merges duplicate normalized identities and rarities before Firebase setup', () => {
  assert.deepEqual(
    validateCardMasterImport([
      { cardId: '1096', cardType: 'character', cardName: ' 鈴木園子 ', rarities: ['sr', 'R'] },
      { cardId: '1096', cardType: 'character', cardName: '鈴木園子', rarities: ['C', 'R'] },
    ]),
    [{ cardId: '1096', cardType: 'character', cardName: '鈴木園子', rarities: ['C', 'R', 'SR'] }],
  );
});

test('CLI import planning partitions deterministic upserts below Firestore batch limits', () => {
  const input = Array.from({ length: 901 }, (_, index) => ({
    cardId: String(9000 + index).padStart(4, '0'),
    cardType: 'event',
    cardName: `事件 ${index}`,
    rarities: ['C'],
  })).reverse();

  const { batches: plan, suppressedCount, suppressedKeys } = planCardMasterImport(input);

  assert.deepEqual(plan.map((chunk) => chunk.length), [450, 450, 1]);
  assert.equal(suppressedCount, 0);
  assert.deepEqual(suppressedKeys, []);
  assert.equal(plan[0][0].cardId, '9000');
  assert.equal(plan[1][0].cardId, '9450');
  assert.equal(plan[2][0].cardId, '9900');
  assert.deepEqual(plan[0][0], {
    key: plan[0][0].key,
    cardId: '9000',
    cardType: 'event',
    cardName: '事件 0',
    rarities: ['C'],
  });
  assert.match(plan[0][0].key, /^card_[a-f0-9]{64}$/);
});

test('CLI import planning omits archived keys and reports only matching suppressions deterministically', () => {
  const input = [
    { cardId: '0501', cardType: 'character', cardName: '黑羽快斗', rarities: ['SR'] },
    { cardId: '0590', cardType: 'character', cardName: '諸伏景光', rarities: ['R'] },
    { cardId: '0982', cardType: 'character', cardName: '中森青子', rarities: ['R'] },
  ];
  const keys = input.map((card) => cardMasterImporter.planCardMasterImport([card]).batches[0][0].key);

  const result = planCardMasterImport(input, {
    suppressedKeys: [keys[2], `card_${'f'.repeat(64)}`, keys[0]],
  });

  assert.deepEqual(result.batches.flat().map(({ key }) => key), [keys[1]]);
  assert.deepEqual(result.suppressedKeys, [keys[0], keys[2]].sort());
  assert.equal(result.suppressedCount, 2);
});

test('CLI import rejects generated-key collisions before initializing Admin Firestore', async () => {
  let initializeCalls = 0;

  await assert.rejects(
    executeCardMasterImport([
      { cardId: '1096', cardType: 'character', cardName: '鈴木園子', rarities: ['SR'] },
      { cardId: '1096', cardType: 'event', cardName: '追跡開始', rarities: ['C'] },
    ], {
      createKey: () => 'card_collision',
      initializeFirestore: async () => {
        initializeCalls += 1;
        throw new Error('Admin Firestore must not initialize.');
      },
    }),
    /card key collision/i,
  );

  assert.equal(initializeCalls, 0);
});

test('CLI import rejects malformed artifact fields before initializing Admin Firestore', async () => {
  let initializeCalls = 0;

  await assert.rejects(
    executeCardMasterImport([
      {
        cardId: '1096',
        cardType: 'character',
        cardName: '鈴木園子',
        rarities: ['SR'],
        effect: 'forbidden',
      },
    ], {
      initializeFirestore: async () => {
        initializeCalls += 1;
        throw new Error('Admin Firestore must not initialize.');
      },
    }),
    /Invalid card master input/,
  );

  assert.equal(initializeCalls, 0);
});

test('CLI import commits chunks sequentially and stops after a failed chunk', async () => {
  const committed = [];
  let createdBatches = 0;
  const db = {
    collection: (_collection) => ({ doc: (id) => ({ id }) }),
    batch: () => {
      const chunkNumber = createdBatches;
      createdBatches += 1;
      const writes = [];
      return {
        set: (reference, data) => writes.push({ id: reference.id, data }),
        commit: async () => {
          if (chunkNumber === 1) throw new Error('network interrupted');
          committed.push(writes);
        },
      };
    },
  };
  const input = Array.from({ length: 451 }, (_, index) => ({
    cardId: String(3000 + index).padStart(4, '0'),
    cardType: 'case',
    cardName: `案件 ${index}`,
    rarities: ['C'],
  }));

  await assert.rejects(
    executeCardMasterImport(input, {
      createKey: (card) => `key_${card.cardId}`,
      initializeFirestore: async () => db,
      listArchives: async () => [],
    }),
    /network interrupted/,
  );

  assert.equal(createdBatches, 2);
  assert.equal(committed.length, 1);
  assert.equal(committed[0].length, 450);
  assert.deepEqual(committed[0][0], {
    id: 'key_3000',
    data: { cardId: '3000', cardType: 'case', cardName: '案件 0', rarities: ['C'] },
  });
  assert.deepEqual(committed[0].at(-1), {
    id: 'key_3449',
    data: { cardId: '3449', cardType: 'case', cardName: '案件 449', rarities: ['C'] },
  });
});

test('CLI import reads and validates archives before creating any Admin write batch', async () => {
  const calls = [];
  const card = { cardId: '0501', cardType: 'character', cardName: '黑羽快斗', rarities: ['SR'] };
  const key = planCardMasterImport([card]).batches[0][0].key;
  const db = {
    batch: () => {
      calls.push('batch');
      throw new Error('suppressed cards must never reach a batch');
    },
    collection: () => ({ doc: (id) => ({ id }) }),
  };

  const result = await executeCardMasterImport([card], {
    initializeFirestore: async () => {
      calls.push('initialize');
      return db;
    },
    listArchives: async (receivedDb) => {
      assert.equal(receivedDb, db);
      calls.push('archives');
      return [{
        key, ...card, disposition: 'disabled', rationale: '錯誤卡片',
        actedBy: 'admin-1', actedAt: new Date('2026-09-04T00:00:00Z'),
      }];
    },
  });

  assert.deepEqual(calls, ['initialize', 'archives']);
  assert.deepEqual(result, { batches: [], suppressedKeys: [key], suppressedCount: 1 });
});

test('CLI import aborts archive read or validation failures before creating write batches', async () => {
  const card = { cardId: '0501', cardType: 'character', cardName: '黑羽快斗', rarities: ['SR'] };
  for (const listArchives of [
    async () => { throw new Error('archive read failed'); },
    async () => [{ key: 'bad', ...card, disposition: 'disabled' }],
  ]) {
    let batchCalls = 0;
    await assert.rejects(executeCardMasterImport([card], {
      initializeFirestore: async () => ({
        batch: () => { batchCalls += 1; },
      }),
      listArchives,
    }));
    assert.equal(batchCalls, 0);
  }
});

test('CLI dry-run reads live archives and reports suppression without creating writes', async () => {
  const fixturePath = '/fixtures/card-master.json';
  const input = Array.from({ length: 451 }, (_, index) => ({
    cardId: String(4000 + index),
    cardType: 'character',
    cardName: `角色 ${index}`,
    rarities: ['r'],
  }));
  const logs = [];
  const executeCalls = [];

  await cardMasterImporter.runCardMasterImportCli(['--dry-run', fixturePath], {
    readJson: async (path) => {
      assert.equal(path, fixturePath);
      return input;
    },
    executeImport: async (_input, options) => {
      executeCalls.push(options);
      return { batches: [Array.from({ length: 450 }), [{}]], suppressedCount: 1, suppressedKeys: ['card_retired'] };
    },
    log: (message) => logs.push(message),
  });

  assert.deepEqual(executeCalls, [{ dryRun: true }]);
  assert.deepEqual(logs, [
    'records=451, batches=2, keyCollisions=0, suppressedCount=1',
    'suppressedKeys=card_retired',
  ]);
});
