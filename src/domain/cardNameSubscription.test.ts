import { describe, expect, it } from 'vitest';
import {
  findCoveringSubscription,
  isKnownSubscriptionCardName,
} from './cardNameSubscription';

const cards = [
  { key: 'character_1', cardId: '0001', cardType: 'character' as const, cardName: '江戶川柯南', rarities: ['SR'] },
  { key: 'event_1', cardId: '0019', cardType: 'case' as const, cardName: '洗牌情緣', rarities: ['C', 'CP'] },
];

describe('card name subscriptions', () => {
  it('requires a complete raw Card Master name', () => {
    expect(isKnownSubscriptionCardName(cards, '江戶川柯南')).toBe(true);
    expect(isKnownSubscriptionCardName(cards, '柯南')).toBe(false);
    expect(isKnownSubscriptionCardName(cards, ' 江戶川柯南')).toBe(false);
  });

  it('chooses the longest deterministic covering subscription', () => {
    expect(findCoveringSubscription(
      ['柯南', '江戶川柯南'],
      '江戶川柯南＆灰原哀',
    )).toBe('江戶川柯南');
    expect(findCoveringSubscription(['江戶川柯南'], '江戶川コナン')).toBeUndefined();
  });
});
