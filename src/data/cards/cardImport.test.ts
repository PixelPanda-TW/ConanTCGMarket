import { describe, expect, it } from 'vitest';
import { validateCardImport } from './cardImport';

describe('validateCardImport', () => {
  it('accepts only supported card-master fields', () => {
    expect(validateCardImport([{ cardId: '1096', characterName: '鈴木園子', rarities: ['SR', 'CP'] }])).toEqual([
      { cardId: '1096', characterName: '鈴木園子', rarities: ['SR', 'CP'] },
    ]);
  });
  it('rejects duplicate IDs, blank rarity, missing names, and unknown fields before any write', () => {
    for (const input of [
      [{ cardId: '1096', rarity: 'R', characterName: 'A' }, { cardId: '1096', rarity: 'R', characterName: 'B' }],
      [{ cardId: '1096', rarity: '', characterName: 'A' }],
      [{ cardId: '1096', rarity: 'R' }],
      [{ cardId: 'B10036', rarity: 'R', characterName: 'A' }],
      [{ cardId: '1096', rarity: 'R', characterName: 'A', effect: 'forbidden' }],
    ]) expect(() => validateCardImport(input)).toThrow('Invalid card master input.');
  });
});
