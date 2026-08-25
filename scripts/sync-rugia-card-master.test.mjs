import test from 'node:test';
import assert from 'node:assert/strict';
import { extractApprovedCardRecords, syncRugiaCardMaster } from './sync-rugia-card-master.mjs';

test('projects source HTML to card ID, character name, and rarity only', () => {
  const html = '<article><h2>B10036 / 1096 (SR)</h2><p>鈴木園子</p><img src="official.jpg"><p>不得保存的牌效文字</p></article>';

  assert.deepEqual(extractApprovedCardRecords(html), [
    { cardId: '1096', characterName: '鈴木園子', rarity: 'SR' },
  ]);
});

test('reads source metadata split across HTML nodes and excludes non-character cards', () => {
  const html = [
    "<span class='cardHolder'><img onclick='showCard(\"B10036_1096\",\"B10036\",\"角色卡\")'/><div class='infoBox'><a>B10036</a> / <a>1096</a> (SR)<img><br><a class='fontsize2'>鈴木園子</a><br><span>不得保存的其他欄位</span></div><div>不得保存的牌效文字</div></span>",
    "<span class='cardHolder'><img onclick='showCard(\"B10037_1097\",\"B10037\",\"情境卡\")'/><div class='infoBox'><a>B10037</a> / <a>1097</a> (C)<br><a class='fontsize2'>非角色名稱</a></div></span>",
  ].join('');

  assert.deepEqual(extractApprovedCardRecords(html), [
    { cardId: '1096', characterName: '鈴木園子', rarity: 'SR' },
  ]);
});

test('reads the marked character name when a card notice precedes the metadata', () => {
  const html = "<span class='cardHolder'><img onclick='showCard(\"B01006_0002\",\"B01006\",\"角色卡\")'/><div class='infoBox'><strong>限制卡</strong><br><a>B01006</a> / <a>0002</a> (SR)<br><a class='fontsize2'>灰原哀</a></div></span>";

  assert.deepEqual(extractApprovedCardRecords(html), [
    { cardId: '0002', characterName: '灰原哀', rarity: 'SR' },
  ]);
});

test('merges every product query into one record with all approved rarities', async () => {
  const requested = [];
  const htmlFor = (rarity) => `<span class='cardHolder'><img onclick='showCard("B10036_1096","B10036","角色卡")'/><div class='infoBox'><a>B10036</a> / <a>1096</a> (${rarity})<br><a class='fontsize2'>鈴木園子</a></div></span>`;
  const records = await syncRugiaCardMaster(async (url) => {
    requested.push(url);
    return new Response(url.endsWith('Version=PR') ? htmlFor('CP') : url.endsWith('Version=B01') ? htmlFor('SR') : '');
  });

  assert.equal(requested.length, 23);
  assert.deepEqual(records, [{ cardId: '1096', characterName: '鈴木園子', rarities: ['CP', 'SR'] }]);
});
