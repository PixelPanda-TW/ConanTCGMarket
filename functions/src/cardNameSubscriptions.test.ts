import { describe, expect, it } from 'vitest';
import {
  matchesSubscribedCardName,
  readSubscriptionCardNames,
} from './cardNameSubscriptions.js';

describe('readSubscriptionCardNames', () => {
  it('accepts unique trimmed complete names and an empty list', () => {
    expect(readSubscriptionCardNames(['江戶川柯南', '洗牌情緣']))
      .toEqual(['江戶川柯南', '洗牌情緣']);
    expect(readSubscriptionCardNames([])).toEqual([]);
  });

  it('rejects malformed subscription lists', () => {
    expect(readSubscriptionCardNames([' 江戶川柯南'])).toBeNull();
    expect(readSubscriptionCardNames(['江戶川柯南', '江戶川柯南'])).toBeNull();
    expect(readSubscriptionCardNames(
      Array.from({ length: 101 }, (_, index) => `卡名-${index}`),
    )).toBeNull();
  });
});

describe('matchesSubscribedCardName', () => {
  it('uses raw case-sensitive substring matching without normalization', () => {
    expect(matchesSubscribedCardName(['江戶川柯南'], '江戶川柯南＆灰原哀')).toBe(true);
    expect(matchesSubscribedCardName(['江戶川柯南'], '江戶川コナン')).toBe(false);
    expect(matchesSubscribedCardName(['CONAN'], 'Conan')).toBe(false);
  });
});
