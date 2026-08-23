import test from 'node:test';
import assert from 'node:assert/strict';
import { extractApprovedCardRecords } from './sync-rugia-card-master.mjs';

test('projects source HTML to card ID, character name, and rarity only', () => {
  const html = '<article><h2>B10036 / 1096 (SR)</h2><p>鈴木園子</p><img src="official.jpg"><p>不得保存的牌效文字</p></article>';

  assert.deepEqual(extractApprovedCardRecords(html), [
    { cardId: '1096', characterName: '鈴木園子', rarity: 'SR' },
  ]);
});
