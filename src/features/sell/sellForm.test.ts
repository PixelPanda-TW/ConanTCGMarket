import { describe, expect, it } from 'vitest';
import type { Card } from '../../domain/models';
import { normalizeSellForm, validateSellForm, type SellFormState } from './sellForm';

const card: Card = { id: 'BT-003', nameZh: '諸伏景光', rarity: 'R' };
const file = new File(['image'], 'card.png', { type: 'image/png' });
const form = (overrides: Partial<SellFormState> = {}): SellFormState => ({
  card, files: [file], listingPrice: '1200', quantity: '2', hasSleeve: false,
  supportsMyShip: false, note: '', ...overrides,
});

describe('sell form', () => {
  it('normalizes text and validates card, image count, price, and quantity', () => {
    expect(normalizeSellForm(form({ listingPrice: ' 500 ', note: ' near mint ' }))).toMatchObject({ listingPrice: '500', note: 'near mint' });
    expect(validateSellForm(form({ card: null, files: [], listingPrice: '0', quantity: '1.5' })).errors).toEqual({
      card: '請選擇卡牌。', files: '請選擇 1 到 3 張商品圖片。', listingPrice: '價格必須大於 0。', quantity: '數量必須是大於 0 的整數。',
    });
  });
});
