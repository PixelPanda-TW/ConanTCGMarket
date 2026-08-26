import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCardMasterImport } from './import-card-master.mjs';

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
