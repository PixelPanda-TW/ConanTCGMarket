import { describe, expect, it } from 'vitest';
import { validateCardImport } from './cardImport';

describe('validateCardImport', () => {
  it('accepts only supported card-master fields', () => {
    expect(validateCardImport([{ cardId: 'CP-001', nameZh: '諸伏景光', rarity: 'CP' }])).toEqual([
      { cardId: 'CP-001', nameZh: '諸伏景光', rarity: 'CP' },
    ]);
  });
  it('rejects duplicate IDs, blank rarity, missing names, and unknown fields before any write', () => {
    for (const input of [
      [{ cardId: 'A', rarity: 'R', nameJa: 'A' }, { cardId: 'A', rarity: 'R', nameJa: 'B' }],
      [{ cardId: 'A', rarity: '', nameJa: 'A' }],
      [{ cardId: 'A', rarity: 'R' }],
      [{ cardId: 'A', rarity: 'R', nameJa: 'A', effect: 'forbidden' }],
    ]) expect(() => validateCardImport(input)).toThrow('Invalid card master input.');
  });
});
