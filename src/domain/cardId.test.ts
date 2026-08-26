import { describe, expect, it } from 'vitest';
import {
  isCompleteCardId,
  normalizeCardId,
  normalizeCardIdQuery,
  validateCardIdQuery,
} from './cardId';

describe('visible card ID helpers', () => {
  it('normalizes a promotional card ID at the browser boundary', () => {
    expect(normalizeCardId(' p001 ')).toBe('P001');
  });

  it.each([
    ['0001', true],
    ['P001', true],
    ['B0982', false],
  ])('recognizes whether %s is a complete visible card ID', (value, expected) => {
    expect(isCompleteCardId(value)).toBe(expected);
  });

  it('normalizes a card ID query before it is used by the search UI', () => {
    expect(normalizeCardIdQuery(' p00 ')).toBe('P00');
  });

  it.each([
    ['P00', undefined],
    ['p001', undefined],
    ['P0001', '卡片 ID 請輸入 4 位數字，或 P 加 3 位數字。'],
  ])('validates the query %s', (value, expected) => {
    expect(validateCardIdQuery(value)).toBe(expected);
  });
});
