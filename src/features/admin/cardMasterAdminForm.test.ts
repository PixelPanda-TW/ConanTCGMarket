import { describe, expect, it } from 'vitest';
import {
  emptyCardMasterAdminForm,
  mergeRarityPreview,
  validateCardMasterAdminForm,
  validateCardRetirementConfirmation,
} from './cardMasterAdminForm';

describe('Card Master admin form', () => {
  it('mirrors server normalization for the four approved fields and rationale', () => {
    expect(validateCardMasterAdminForm({
      cardId: ' p001 ', cardType: 'partner', cardName: ' 江戶川柯南\u0301 ',
      rarities: [' sr ', 'R', 'SR'], rationale: ' 新增缺漏 ',
    })).toEqual({
      values: {
        cardId: 'P001', cardType: 'partner', cardName: '江戶川柯南́',
        rarities: ['R', 'SR'], rationale: '新增缺漏',
      },
      errors: {},
    });
  });

  it.each([
    ['cardId', { cardId: 'B0982' }],
    ['cardName', { cardName: ' ' }],
    ['cardName', { cardName: '名'.repeat(201) }],
    ['rarities', { rarities: [] }],
    ['rarities', { rarities: [' '] }],
    ['rarities', { rarities: Array.from({ length: 21 }, (_, index) => `R${index}`) }],
    ['rationale', { rationale: ' ' }],
    ['rationale', { rationale: '理'.repeat(501) }],
  ])('rejects invalid %s without producing an authorized operation', (field, override) => {
    const result = validateCardMasterAdminForm({
      cardId: '0501', cardType: 'character', cardName: '黑羽快斗',
      rarities: ['SR'], rationale: '新增缺漏', ...override,
    });
    expect(result.errors).toHaveProperty(field);
  });

  it('creates a fresh repeatable-rarity form', () => {
    expect(emptyCardMasterAdminForm()).toEqual({
      cardId: '', cardType: 'character', cardName: '', rarities: [''], rationale: '',
    });
    expect(emptyCardMasterAdminForm().rarities).not.toBe(emptyCardMasterAdminForm().rarities);
  });

  it('previews a deterministic rarity union without changing either input', () => {
    const source = ['SR', 'R'];
    const target = ['CP', 'R'];
    expect(mergeRarityPreview(source, target)).toEqual(['CP', 'R', 'SR']);
    expect(source).toEqual(['SR', 'R']);
    expect(target).toEqual(['CP', 'R']);
  });

  it.each([
    ['', true, '請填寫異動原因。'],
    ['理'.repeat(501), true, '異動原因須為 1 到 500 字。'],
    ['合併重複資料', false, '請勾選確認後再繼續。'],
  ])('requires a bounded rationale and explicit destructive confirmation', (rationale, confirmed, message) => {
    expect(validateCardRetirementConfirmation({ rationale, confirmed })).toEqual({ error: message });
  });

  it('normalizes a valid retirement rationale', () => {
    expect(validateCardRetirementConfirmation({ rationale: ' 合併重複資料 ', confirmed: true }))
      .toEqual({ rationale: '合併重複資料' });
  });
});
