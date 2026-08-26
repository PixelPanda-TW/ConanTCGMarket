import { describe, expect, it } from 'vitest';
import { validateCardImport } from './cardImport';

describe('validateCardImport', () => {
  it('accepts all approved card types and returns only normalized persisted fields', () => {
    expect(validateCardImport([
      { cardId: '0001', cardType: 'character', cardName: ' 江戶川柯南 ', rarities: ['R', 'R'] },
      { cardId: '1100', cardType: 'event', cardName: '追跡開始', rarities: ['C'] },
      { cardId: '1150', cardType: 'case', cardName: '緋色の真相', rarities: ['C'] },
      { cardId: 'p001', cardType: 'partner', cardName: '江戶川柯南', rarities: ['p'] },
    ])).toEqual([
      { cardId: '0001', cardType: 'character', cardName: '江戶川柯南', rarities: ['R'] },
      { cardId: '1100', cardType: 'event', cardName: '追跡開始', rarities: ['C'] },
      { cardId: '1150', cardType: 'case', cardName: '緋色の真相', rarities: ['C'] },
      { cardId: 'P001', cardType: 'partner', cardName: '江戶川柯南', rarities: ['P'] },
    ]);
  });
  it('merges duplicate normalized identities and deduplicates their rarities', () => {
    expect(validateCardImport([
      { cardId: '1096', cardType: 'character', cardName: ' 鈴木園子 ', rarities: ['SR', 'R'] },
      { cardId: '1096', cardType: 'character', cardName: '鈴木園子', rarities: ['c', 'R'] },
    ])).toEqual([
      { cardId: '1096', cardType: 'character', cardName: '鈴木園子', rarities: ['C', 'R', 'SR'] },
    ]);
  });

  it('preserves distinct composite identities that share a visible ID in deterministic order', () => {
    expect(validateCardImport([
      { cardId: '0501', cardType: 'event', cardName: '事件 0501', rarities: ['D'] },
      { cardId: '0501', cardType: 'character', cardName: '諸伏高明', rarities: ['d'] },
      { cardId: '0501', cardType: 'character', cardName: ' 諸伏高明 ', rarities: ['SR'] },
    ])).toEqual([
      { cardId: '0501', cardType: 'character', cardName: '諸伏高明', rarities: ['D', 'SR'] },
      { cardId: '0501', cardType: 'event', cardName: '事件 0501', rarities: ['D'] },
    ]);
  });

  it('rejects invalid IDs, unknown types, forbidden fields, and empty rarities before any write', () => {
    for (const input of [
      [{ cardId: 'B10036', cardType: 'character', cardName: 'A', rarities: ['R'] }],
      [{ cardId: '1096', cardType: 'unknown', cardName: 'A', rarities: ['R'] }],
      [{ cardId: '1096', cardType: 'character', cardName: 'A', rarities: ['R'], effect: 'forbidden' }],
      [{ cardId: '1096', cardType: 'character', cardName: 'A', rarities: [] }],
    ]) expect(() => validateCardImport(input)).toThrow('Invalid card master input.');
  });
});
