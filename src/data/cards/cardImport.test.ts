import { describe, expect, it } from 'vitest';
import { validateCardImport } from './cardImport';

describe('validateCardImport', () => {
  it('accepts all approved card types and returns only normalized persisted fields', () => {
    expect(validateCardImport([
      { cardId: '0001', cardType: 'character', cardName: ' 江戶川柯南 ', rarities: ['R', 'R'] },
      { cardId: '1100', cardType: 'event', cardName: '追跡開始', rarities: ['C'] },
      { cardId: '1150', cardType: 'case', cardName: '緋色の真相', rarities: ['C'] },
      { cardId: '1167', cardType: 'partner', cardName: '江戶川柯南', rarities: ['P'] },
    ])).toEqual([
      { cardId: '0001', cardType: 'character', cardName: '江戶川柯南', rarities: ['R'] },
      { cardId: '1100', cardType: 'event', cardName: '追跡開始', rarities: ['C'] },
      { cardId: '1150', cardType: 'case', cardName: '緋色の真相', rarities: ['C'] },
      { cardId: '1167', cardType: 'partner', cardName: '江戶川柯南', rarities: ['P'] },
    ]);
  });
  it('merges duplicate normalized identities and deduplicates their rarities', () => {
    expect(validateCardImport([
      { cardId: '1096', cardType: 'character', cardName: ' 鈴木園子 ', rarities: ['SR', 'R'] },
      { cardId: '1096', cardType: 'character', cardName: '鈴木園子', rarities: ['C', 'R'] },
    ])).toEqual([
      { cardId: '1096', cardType: 'character', cardName: '鈴木園子', rarities: ['C', 'R', 'SR'] },
    ]);
  });
  it('rejects conflicting duplicate identities, invalid IDs, unknown types, and forbidden fields before any write', () => {
    for (const input of [
      [
        { cardId: '1096', cardType: 'character', cardName: 'A', rarities: ['R'] },
        { cardId: '1096', cardType: 'event', cardName: 'B', rarities: ['C'] },
      ],
      [{ cardId: 'B10036', cardType: 'character', cardName: 'A', rarities: ['R'] }],
      [{ cardId: '1096', cardType: 'unknown', cardName: 'A', rarities: ['R'] }],
      [{ cardId: '1096', cardType: 'character', cardName: 'A', rarities: ['R'], effect: 'forbidden' }],
      [{ cardId: '1096', cardType: 'character', cardName: 'A', rarities: [] }],
    ]) expect(() => validateCardImport(input)).toThrow('Invalid card master input.');
  });
});
