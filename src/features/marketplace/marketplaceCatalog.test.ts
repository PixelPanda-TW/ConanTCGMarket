import { describe, expect, it } from 'vitest';
import { resolveListingCard } from './marketplaceCatalog';

describe('resolveListingCard', () => {
  it('uses development-card fallback so a listing is not hidden before Card Master import', () => {
    expect(resolveListingCard('CP-001', [], [{ id: 'CP-001', cardType: 'character', cardName: '諸伏景光', rarities: ['CP'], nameZh: '諸伏景光', rarity: 'CP' }])).toMatchObject({ nameZh: '諸伏景光', rarity: 'CP' });
  });
});
