import { describe, expect, it } from 'vitest';
import {
  getCardIdsForMetadata,
  getCharacterNameSuggestions,
  getRaritiesForCharacter,
  hasKnownCardMetadata,
  hasKnownCharacterName,
  normalizeSellForm,
  validateSellForm,
  type SellFormState,
} from './sellForm';

const file = new File(['image'], 'card.png', { type: 'image/png' });
const form = (overrides: Partial<SellFormState> = {}): SellFormState => ({
  cardId: '1096', characterName: '鈴木園子', rarity: 'SR', files: [file], listingPrice: '1200', quantity: '2', hasSleeve: false,
  sleeveFee: '', supportsMyShip: false, myShipFee: '', note: '', ...overrides,
});

describe('sell form', () => {
  it('normalizes card metadata and validates all required listing fields', () => {
    expect(normalizeSellForm(form({ cardId: ' 0164 ', characterName: ' 鈴木園子 ', rarity: ' SR ', listingPrice: ' 500 ', note: ' near mint ' }))).toMatchObject({ cardId: '0164', characterName: '鈴木園子', rarity: 'SR', listingPrice: '500', note: 'near mint' });
    expect(validateSellForm(form({ cardId: '109', characterName: '', rarity: '', files: [], listingPrice: '0', quantity: '1.5' })).errors).toEqual({
      cardId: '卡片 ID 必須是 4 位數字。', characterName: '請填寫角色／人名。', rarity: '請填寫稀有度。', files: '請選擇 1 到 3 張商品圖片。', listingPrice: '價格必須大於 0。', quantity: '數量必須是大於 0 的整數。',
    });
  });

  it('accepts only character names present in Card Master', () => {
    expect(hasKnownCharacterName([{ id: '1096', cardType: 'character', cardName: '鈴木園子', characterName: '鈴木園子', rarity: 'SR', rarities: ['SR'] }], '鈴木園子')).toBe(true);
    expect(hasKnownCharacterName([{ id: '1096', cardType: 'character', cardName: '鈴木園子', characterName: '鈴木園子', rarity: 'SR', rarities: ['SR'] }], '不存在的人名')).toBe(false);
  });

  it('accepts only a matching Card Master ID, character name, and one of its rarities', () => {
    const cards = [{ id: '1096', characterName: '鈴木園子', rarities: ['SR', 'CP'] }];

    expect(hasKnownCardMetadata(cards, { cardId: '1096', characterName: '鈴木園子', rarity: 'CP' })).toBe(true);
    expect(hasKnownCardMetadata(cards, { cardId: '1096', characterName: '鈴木園子', rarity: 'R' })).toBe(false);
    expect(hasKnownCardMetadata(cards, { cardId: '1096', characterName: '毛利蘭', rarity: 'SR' })).toBe(false);
  });

  it('narrows autocomplete choices from character name to rarity then card ID', () => {
    const cards = [
      { id: '0338', characterName: '諸伏景光', rarities: ['R', 'CP'] },
      { id: '0590', characterName: '諸伏景光', rarities: ['R'] },
      { id: '1010', characterName: '諸伏高明', rarities: ['SR'] },
      { id: '1096', characterName: '鈴木園子', rarities: ['SR'] },
    ];

    expect(getCharacterNameSuggestions(cards, '諸伏')).toEqual(['諸伏景光', '諸伏高明']);
    expect(getRaritiesForCharacter(cards, '諸伏景光')).toEqual(['CP', 'R']);
    expect(getCardIdsForMetadata(cards, '諸伏景光', 'R')).toEqual(['0338', '0590']);
    expect(getCardIdsForMetadata(cards, '諸伏景光', '')).toEqual([]);
  });

  it('requires a non-negative conditional fee only when the matching service is selected', () => {
    expect(validateSellForm(form({ hasSleeve: true, sleeveFee: '' })).errors.sleeveFee).toBe('請填寫包材費。');
    expect(validateSellForm(form({ supportsMyShip: true, myShipFee: '' })).errors.myShipFee).toBe('請填寫賣貨便加價。');
    expect(validateSellForm(form({ hasSleeve: true, sleeveFee: '0', supportsMyShip: true, myShipFee: '60' })).errors).not.toHaveProperty('sleeveFee');
    expect(validateSellForm(form({ hasSleeve: true, sleeveFee: '-1' })).errors.sleeveFee).toBe('包材費不可小於 0。');
  });
});
