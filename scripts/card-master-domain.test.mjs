import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateCardMasterRecords,
  buildSyncResult,
  canonicalCardIdentity,
  canonicalCardTuple,
  createCardKey,
  normalizeSourceCardId,
} from './card-master-domain.mjs';

test('normalizes approved numeric and P-prefixed source card IDs without losing leading zeroes', () => {
  assert.deepEqual(normalizeSourceCardId(' 0001 '), { cardId: '0001', correction: null });
  assert.deepEqual(normalizeSourceCardId(' p001 '), { cardId: 'P001', correction: null });
});

test('applies only the approved B0982 source correction', () => {
  assert.deepEqual(normalizeSourceCardId('B0982'), {
    cardId: '0982',
    correction: { from: 'B0982', to: '0982' },
  });
  assert.throws(() => normalizeSourceCardId('B0123'), /invalid card ID/i);
  assert.throws(() => normalizeSourceCardId('Q001'), /invalid card ID/i);
});

test('builds an NFC-normalized canonical tuple and stable full SHA-256 key', () => {
  const decomposedName = 'A\u030A';
  const record = { cardType: 'character', cardName: ` ${decomposedName} `, cardId: ' p001 ' };

  assert.deepEqual(canonicalCardTuple(record), ['character', 'Å', 'P001']);
  assert.equal(canonicalCardIdentity(record), '["character","Å","P001"]');
  assert.equal(createCardKey(record), createCardKey({ ...record, cardName: 'Å', cardId: 'P001' }));
  assert.match(
    createCardKey({ cardType: 'character', cardName: '中森青子', cardId: '0982' }),
    /^card_[a-f0-9]{64}$/,
  );
});

test('aggregates only identical composite identities and unions normalized rarities', () => {
  assert.deepEqual(aggregateCardMasterRecords([
    { cardId: '0501', cardType: 'character', cardName: ' 黑羽快斗 ', rarities: [' sr ', 'R'] },
    { cardId: '0501', cardType: 'character', cardName: '黑羽快斗', rarities: ['c', 'SR'] },
    { cardId: '0501', cardType: 'event', cardName: '黑羽快斗', rarities: ['c'] },
    { cardId: '0501', cardType: 'character', cardName: '中森青子', rarities: ['SR'] },
  ]), [
    { cardId: '0501', cardType: 'character', cardName: '中森青子', rarities: ['SR'] },
    { cardId: '0501', cardType: 'character', cardName: '黑羽快斗', rarities: ['C', 'R', 'SR'] },
    { cardId: '0501', cardType: 'event', cardName: '黑羽快斗', rarities: ['C'] },
  ]);
});

test('rejects invalid artifact fields before aggregation', () => {
  const valid = { cardId: '0001', cardType: 'character', cardName: '江戶川柯南', rarities: ['R'] };

  assert.throws(() => aggregateCardMasterRecords([{ ...valid, cardType: 'item' }]), /invalid card type/i);
  assert.throws(() => aggregateCardMasterRecords([{ ...valid, cardName: '  ' }]), /empty card name/i);
  assert.throws(() => aggregateCardMasterRecords([{ ...valid, cardId: 'B0001' }]), /invalid card ID/i);
  assert.throws(() => aggregateCardMasterRecords([{ ...valid, rarities: [] }]), /empty rarit/i);
  assert.throws(() => aggregateCardMasterRecords([{ ...valid, rarities: ['  '] }]), /empty rarit/i);
});

test('builds structured counts while separating exact duplicates from canonical merging', () => {
  const result = buildSyncResult([
    { cardId: 'P001', cardType: 'partner', cardName: '江戶川柯南', rarity: 'PR' },
    { cardId: '0982', cardType: 'character', cardName: '中森青子', rarity: 'R' },
    { cardId: '0501', cardType: 'character', cardName: '黑羽快斗', rarity: 'SR' },
    { cardId: '0501', cardType: 'character', cardName: '黑羽快斗', rarity: 'SR' },
    { cardId: '0501', cardType: 'character', cardName: '黑羽快斗', rarity: 'CP' },
    { cardId: '0501', cardType: 'event', cardName: '快斗的謎題', rarity: 'C' },
  ], [{ from: 'B0982', to: '0982' }], { versionCount: 23 });

  assert.deepEqual(result.cards, [
    { cardId: '0501', cardType: 'character', cardName: '黑羽快斗', rarities: ['CP', 'SR'] },
    { cardId: '0501', cardType: 'event', cardName: '快斗的謎題', rarities: ['C'] },
    { cardId: '0982', cardType: 'character', cardName: '中森青子', rarities: ['R'] },
    { cardId: 'P001', cardType: 'partner', cardName: '江戶川柯南', rarities: ['PR'] },
  ]);
  assert.deepEqual(result.report, {
    versionCount: 23,
    occurrenceCount: 6,
    canonicalCardCount: 4,
    cardTypeCounts: { character: 2, event: 1, case: 0, partner: 1 },
    idFormatCounts: { numeric: 3, prefixedP: 1 },
    sharedCardIdCount: 1,
    duplicateOccurrenceCount: 1,
    corrections: [{ from: 'B0982', to: '0982', count: 1 }],
    keyCollisionCount: 0,
  });
});

test('reports a generated-key collision only when one key maps to different tuples', () => {
  const { report } = buildSyncResult([
    { cardId: '0501', cardType: 'character', cardName: '黑羽快斗', rarity: 'SR' },
    { cardId: '0501', cardType: 'event', cardName: '快斗的謎題', rarity: 'C' },
  ], [], { createKey: () => 'card_collision' });

  assert.equal(report.keyCollisionCount, 1);
});
