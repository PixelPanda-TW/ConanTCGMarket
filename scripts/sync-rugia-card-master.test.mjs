import test from 'node:test';
import assert from 'node:assert/strict';
import * as syncCardMaster from './sync-rugia-card-master.mjs';

const {
  extractApprovedCardRecords,
  formatSyncReport,
  runSyncCli,
  syncRugiaCardMaster,
} = syncCardMaster;

test('projects all approved source card types to an occurrence with approved fields only', () => {
  const html = [
    "<span class='cardHolder'><img onclick='showCard(\"B01001_0001\",\"B01001\",\"角色卡\")'/><div class='infoBox'><a>B01001</a> / <a>0001</a> (R)<br><a class='fontsize2'>江戶川柯南</a><br><span>不得保存的其他欄位</span></div><div>不得保存的牌效文字</div></span>",
    "<span class='cardHolder'><img onclick='showCard(\"B11000_1100\",\"B11000\",\"事件卡\")'/><div class='infoBox'><a>B11000</a> / <a>1100</a> (C)<br><a class='fontsize2'>追跡開始</a></div></span>",
    "<span class='cardHolder'><img onclick='showCard(\"B11500_1150\",\"B11500\",\"情境卡\")'/><div class='infoBox'><a>B11500</a> / <a>1150</a> (C)<br><a class='fontsize2'>緋色の真相</a></div></span>",
    "<span class='cardHolder'><img onclick='showCard(\"B11670_1167\",\"B11670\",\"拍檔卡\")'/><div class='infoBox'><a>B11670</a> / <a>1167</a> (P)<br><a class='fontsize2'>江戶川柯南</a></div></span>",
  ].join('');

  assert.deepEqual(extractApprovedCardRecords(html), [
    { cardId: '0001', cardType: 'character', cardName: '江戶川柯南', rarity: 'R' },
    { cardId: '1100', cardType: 'event', cardName: '追跡開始', rarity: 'C' },
    { cardId: '1150', cardType: 'case', cardName: '緋色の真相', rarity: 'C' },
    { cardId: '1167', cardType: 'partner', cardName: '江戶川柯南', rarity: 'P' },
  ]);
});

test('reads the marked character name when a card notice precedes the metadata', () => {
  const html = "<span class='cardHolder'><img onclick='showCard(\"B01006_0002\",\"B01006\",\"角色卡\")'/><div class='infoBox'><strong>限制卡</strong><br><a>B01006</a> / <a>0002</a> (SR)<br><a class='fontsize2'>灰原哀</a></div></span>";

  assert.deepEqual(extractApprovedCardRecords(html), [
    { cardId: '0002', cardType: 'character', cardName: '灰原哀', rarity: 'SR' },
  ]);
});

test('ignores layout card holders that do not contain a source card record', () => {
  const html = [
    "<span class='cardHolder'><table><tr><td>搜尋控制項</td></tr></table></span>",
    "<span class='cardHolder'><img onclick='showCard(\"B01006_0002\",\"B01006\",\"角色卡\")'/><div class='infoBox'><a>B01006</a> / <a>0002</a> (SR)<br><a class='fontsize2'>灰原哀</a></div></span>",
  ].join('');

  assert.deepEqual(extractApprovedCardRecords(html), [
    { cardId: '0002', cardType: 'character', cardName: '灰原哀', rarity: 'SR' },
  ]);
});

test('rejects unknown source card types before producing a partial projection', () => {
  const html = "<span class='cardHolder'><img onclick='showCard(\"B10036_1096\",\"B10036\",\"道具卡\")'/><div class='infoBox'><a>B10036</a> / <a>1096</a> (SR)<br><a class='fontsize2'>不明卡片</a></div></span>";

  assert.throws(() => extractApprovedCardRecords(html), /unknown source card type/i);
});

test('accepts a complete P-prefixed source card ID', () => {
  const html = "<span class='cardHolder'><img onclick='showCard(\"PR001_P001\",\"PR001\",\"拍檔卡\")'/><div class='infoBox'><a>PR001</a> / <a>P001</a> (PR)<br><a class='fontsize2'>江戶川柯南</a></div></span>";

  assert.deepEqual(extractApprovedCardRecords(html), [
    { cardId: 'P001', cardType: 'partner', cardName: '江戶川柯南', rarity: 'PR' },
  ]);
});

test('corrects only B0982 while keeping the occurrence projection allowlisted', () => {
  const html = "<span class='cardHolder'><img onclick='showCard(\"B0982\",\"B0982\",\"角色卡\")'/><div class='infoBox'><a>B0982</a> / <a>B0982</a> (sr)<br><a class='fontsize2'>中森青子</a><br><span>不得保存的效果</span></div></span>";

  assert.deepEqual(extractApprovedCardRecords(html), [
    { cardId: '0982', cardType: 'character', cardName: '中森青子', rarity: 'sr' },
  ]);
  assert.throws(
    () => extractApprovedCardRecords(html.replaceAll('B0982', 'B0123')),
    /invalid card ID/i,
  );
});

test('rejects a source card record without a card name before producing output', () => {
  const html = "<span class='cardHolder'><img onclick='showCard(\"B01006_0002\",\"B01006\",\"角色卡\")'/><div class='infoBox'><a>B01006</a> / <a>0002</a> (SR)</div></span>";

  assert.throws(() => extractApprovedCardRecords(html), /missing an approved field/i);
});

test('syncs corrected, prefixed, shared-ID, and duplicate mocked occurrences into a structured result', async () => {
  const requested = [];
  const holder = (sourceCode, cardId, sourceType, name, rarity) => `<span class='cardHolder'><img onclick='showCard("${sourceCode}_${cardId}","${sourceCode}","${sourceType}")'/><div class='infoBox'><a>${sourceCode}</a> / <a>${cardId}</a> (${rarity})<br><a class='fontsize2'>${name}</a></div></span>`;
  const fixture = [
    holder('PR001', 'P001', '拍檔卡', '江戶川柯南', 'PR'),
    holder('B0982', 'B0982', '角色卡', '中森青子', 'R'),
    holder('B0501', '0501', '角色卡', '黑羽快斗', 'SR'),
    holder('D0501', '0501', '事件卡', '快斗的謎題', 'C'),
    holder('B0501', '0501', '角色卡', '黑羽快斗', 'SR'),
  ].join('');

  const result = await syncRugiaCardMaster(async (url) => {
    requested.push(url);
    return new Response(url.endsWith('Version=PR') ? fixture : '');
  });

  assert.equal(requested.length, 23);
  assert.deepEqual(result.cards, [
    { cardId: '0501', cardType: 'character', cardName: '黑羽快斗', rarities: ['SR'] },
    { cardId: '0501', cardType: 'event', cardName: '快斗的謎題', rarities: ['C'] },
    { cardId: '0982', cardType: 'character', cardName: '中森青子', rarities: ['R'] },
    { cardId: 'P001', cardType: 'partner', cardName: '江戶川柯南', rarities: ['PR'] },
  ]);
  assert.deepEqual(result.report, {
    versionCount: 23,
    occurrenceCount: 5,
    canonicalCardCount: 4,
    cardTypeCounts: { character: 2, event: 1, case: 0, partner: 1 },
    idFormatCounts: { numeric: 3, prefixedP: 1 },
    sharedCardIdCount: 1,
    duplicateOccurrenceCount: 1,
    corrections: [{ from: 'B0982', to: '0982', count: 1 }],
    keyCollisionCount: 0,
  });
});

test('formats every structured audit field', () => {
  assert.equal(
    formatSyncReport({
      versionCount: 23,
      occurrenceCount: 6,
      canonicalCardCount: 4,
      cardTypeCounts: { character: 2, event: 1, case: 0, partner: 1 },
      idFormatCounts: { numeric: 3, prefixedP: 1 },
      sharedCardIdCount: 1,
      duplicateOccurrenceCount: 1,
      corrections: [{ from: 'B0982', to: '0982', count: 1 }],
      keyCollisionCount: 0,
    }),
    'Rugia Card Master sync report: versions=23, occurrences=6, canonicalCards=4, types(character=2,event=1,case=0,partner=1), idFormats(numeric=3,prefixedP=1), sharedCardIds=1, duplicateOccurrences=1, corrections=B0982->0982(1), keyCollisions=0.',
  );
});

test('CLI writes only cards and refuses to write a result with key collisions', async () => {
  const cleanResult = {
    cards: [{ cardId: 'P001', cardType: 'partner', cardName: '江戶川柯南', rarities: ['PR'] }],
    report: {
      versionCount: 23,
      occurrenceCount: 1,
      canonicalCardCount: 1,
      cardTypeCounts: { character: 0, event: 0, case: 0, partner: 1 },
      idFormatCounts: { numeric: 0, prefixedP: 1 },
      sharedCardIdCount: 0,
      duplicateOccurrenceCount: 0,
      corrections: [],
      keyCollisionCount: 0,
    },
  };
  const writes = [];
  const logs = [];

  await runSyncCli('/tmp/cards.json', {
    sync: async () => cleanResult,
    write: async (...args) => writes.push(args),
    log: (message) => logs.push(message),
  });

  assert.deepEqual(writes, [[
    '/tmp/cards.json',
    `${JSON.stringify(cleanResult.cards, null, 2)}\n`,
    'utf8',
  ]]);
  assert.equal(logs.at(-1), formatSyncReport(cleanResult.report));

  let collisionWrites = 0;
  await assert.rejects(
    runSyncCli('/tmp/cards.json', {
      sync: async () => ({
        ...cleanResult,
        report: { ...cleanResult.report, keyCollisionCount: 1 },
      }),
      write: async () => { collisionWrites += 1; },
      log: () => {},
    }),
    /key collision/i,
  );
  assert.equal(collisionWrites, 0);
});
