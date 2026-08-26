import test from 'node:test';
import assert from 'node:assert/strict';
import { extractApprovedCardRecords, syncRugiaCardMaster } from './sync-rugia-card-master.mjs';

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

test('rejects a source card record with a non-four-digit ID before producing output', () => {
  const html = "<span class='cardHolder'><img onclick='showCard(\"PR001_P001\",\"PR001\",\"拍檔卡\")'/><div class='infoBox'><a>PR001</a> / <a>P001</a> (PR)<br><a class='fontsize2'>江戶川柯南</a></div></span>";

  assert.throws(() => extractApprovedCardRecords(html), /invalid card ID/i);
});

test('rejects a source card record without a card name before producing output', () => {
  const html = "<span class='cardHolder'><img onclick='showCard(\"B01006_0002\",\"B01006\",\"角色卡\")'/><div class='infoBox'><a>B01006</a> / <a>0002</a> (SR)</div></span>";

  assert.throws(() => extractApprovedCardRecords(html), /missing an approved field/i);
});

test('merges identical card identity occurrences and sorts deduplicated rarities', async () => {
  const requested = [];
  const htmlFor = (rarity) => `<span class='cardHolder'><img onclick='showCard("B10036_1096","B10036","角色卡")'/><div class='infoBox'><a>B10036</a> / <a>1096</a> (${rarity})<br><a class='fontsize2'>鈴木園子</a></div></span>`;
  const records = await syncRugiaCardMaster(async (url) => {
    requested.push(url);
    return new Response(url.endsWith('Version=PR') ? htmlFor('SR') : url.endsWith('Version=B01') ? htmlFor('CP') : htmlFor('SR'));
  });

  assert.equal(requested.length, 23);
  assert.deepEqual(records, [{ cardId: '1096', cardType: 'character', cardName: '鈴木園子', rarities: ['CP', 'SR'] }]);
});

test('rejects a card ID whose type or name conflicts across versions before returning output', async () => {
  const htmlFor = (type, name) => `<span class='cardHolder'><img onclick='showCard("B10036_1096","B10036","${type}")'/><div class='infoBox'><a>B10036</a> / <a>1096</a> (SR)<br><a class='fontsize2'>${name}</a></div></span>`;

  await assert.rejects(
    syncRugiaCardMaster(async (url) => new Response(url.endsWith('Version=PR') ? htmlFor('角色卡', '鈴木園子') : htmlFor('事件卡', '追跡開始'))),
    /1096/,
  );
});
