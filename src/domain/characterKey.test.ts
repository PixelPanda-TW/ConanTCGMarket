import { describe, expect, it } from 'vitest';
import { toCharacterKey } from './characterKey';

describe('toCharacterKey', () => {
  it('normalizes whitespace and Unicode without changing the character name', () => {
    expect(toCharacterKey('  諸伏　景光  ')).toBe('諸伏 景光');
  });

  it('rejects an empty character name', () => {
    expect(() => toCharacterKey('  ')).toThrow('Character name is required.');
  });
});
