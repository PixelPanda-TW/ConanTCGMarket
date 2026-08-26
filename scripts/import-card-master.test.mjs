import test from 'node:test';
import assert from 'node:assert/strict';
import {
  executeCardMasterImport,
  planCardMasterImport,
  validateCardMasterImport,
} from './import-card-master.mjs';

test('CLI import validation merges duplicate normalized identities and rarities before Firebase setup', () => {
  assert.deepEqual(
    validateCardMasterImport([
      { cardId: '1096', cardType: 'character', cardName: ' 鈴木園子 ', rarities: ['SR', 'R'] },
      { cardId: '1096', cardType: 'character', cardName: '鈴木園子', rarities: ['C', 'R'] },
    ]),
    [{ cardId: '1096', cardType: 'character', cardName: '鈴木園子', rarities: ['C', 'R', 'SR'] }],
  );
});

test('CLI import validation rejects a same-ID identity conflict before Firebase setup', () => {
  assert.throws(
    () => validateCardMasterImport([
      { cardId: '1096', cardType: 'character', cardName: '鈴木園子', rarities: ['SR'] },
      { cardId: '1096', cardType: 'event', cardName: '追跡開始', rarities: ['C'] },
    ]),
    /Invalid card master input/,
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
    cardId: '9000', cardType: 'event', cardName: '事件 0', rarities: ['C'],
  });
});

test('CLI import rejects identity conflicts before initializing Admin Firestore', async () => {
  let initializeCalls = 0;

  await assert.rejects(
    executeCardMasterImport([
      { cardId: '1096', cardType: 'character', cardName: '鈴木園子', rarities: ['SR'] },
      { cardId: '1096', cardType: 'event', cardName: '追跡開始', rarities: ['C'] },
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
    executeCardMasterImport(input, { initializeFirestore: async () => db }),
    /network interrupted/,
  );

  assert.equal(createdBatches, 2);
  assert.equal(committed.length, 1);
  assert.equal(committed[0].length, 450);
  assert.deepEqual(committed[0][0], {
    id: '3000', data: { cardType: 'case', cardName: '案件 0', rarities: ['C'] },
  });
  assert.deepEqual(committed[0].at(-1), {
    id: '3449', data: { cardType: 'case', cardName: '案件 449', rarities: ['C'] },
  });
});
