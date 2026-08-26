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

  const plan = planCardMasterImport(input);

  assert.deepEqual(plan.map((chunk) => chunk.length), [450, 450, 1]);
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

test('CLI dry-run reads and plans the artifact without executing the import', async () => {
  const fixturePath = '/fixtures/card-master.json';
  const input = Array.from({ length: 451 }, (_, index) => ({
    cardId: String(4000 + index),
    cardType: 'character',
    cardName: `角色 ${index}`,
    rarities: ['r'],
  }));
  const logs = [];
  let executeCalls = 0;

  await cardMasterImporter.runCardMasterImportCli(['--dry-run', fixturePath], {
    readJson: async (path) => {
      assert.equal(path, fixturePath);
      return input;
    },
    executeImport: async () => {
      executeCalls += 1;
      throw new Error('Dry-run must not execute the import.');
    },
    log: (message) => logs.push(message),
  });

  assert.equal(executeCalls, 0);
  assert.deepEqual(logs, ['records=451, batches=2, keyCollisions=0']);
});
