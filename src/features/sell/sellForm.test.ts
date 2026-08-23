import { describe, expect, it } from 'vitest';
import { normalizeSellForm, validateSellForm, type SellFormState } from './sellForm';

const file = new File(['image'], 'card.png', { type: 'image/png' });
const form = (overrides: Partial<SellFormState> = {}): SellFormState => ({
  cardId: '1096', files: [file], listingPrice: '1200', quantity: '2', hasSleeve: false,
  supportsMyShip: false, note: '', ...overrides,
});

describe('sell form', () => {
  it('normalizes a four-digit card ID and validates listing fields', () => {
    expect(normalizeSellForm(form({ cardId: ' 0164 ', listingPrice: ' 500 ', note: ' near mint ' }))).toMatchObject({ cardId: '0164', listingPrice: '500', note: 'near mint' });
    expect(validateSellForm(form({ cardId: '109', files: [], listingPrice: '0', quantity: '1.5' })).errors).toEqual({
      cardId: '卡片 ID 必須是 4 位數字。', files: '請選擇 1 到 3 張商品圖片。', listingPrice: '價格必須大於 0。', quantity: '數量必須是大於 0 的整數。',
    });
  });
});
