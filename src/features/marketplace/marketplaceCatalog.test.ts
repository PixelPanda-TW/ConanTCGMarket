import { describe, expect, it } from 'vitest';
import type { Listing } from '../../domain/models';
import { resolveListingCard, resolveMarketplaceListingMetadata } from './marketplaceCatalog';

describe('resolveListingCard', () => {
  it('uses development-card fallback so a listing is not hidden before Card Master import', () => {
    expect(resolveListingCard('CP-001', [], [{ key: 'character_CP-001', cardId: 'CP-001', cardType: 'character', cardName: '諸伏景光', rarities: ['CP'] }])).toMatchObject({ cardName: '諸伏景光', rarities: ['CP'] });
  });

  it('resolves listing metadata from the new snapshot before legacy and Card Master data', () => {
    const listing = { cardId: '1100', cardType: 'event', cardName: '上架快照', rarity: 'SR', characterName: '舊角色' } as Listing;
    const result = resolveMarketplaceListingMetadata(listing, [
      { key: 'event_1100', cardId: '1100', cardType: 'event', cardName: 'Card Master', rarities: ['C'] },
    ], []);

    expect(result).toEqual({ cardType: 'event', cardName: '上架快照', rarity: 'SR', cardId: '1100' });
  });

  it('falls back from a legacy character snapshot to Card Master and explicit unavailable labels', () => {
    const legacy = { cardId: '0501', characterName: '諸伏高明', rarity: 'D' } as Listing;
    const cardMasterOnly = { cardId: '1100' } as Listing;
    const missing = { cardId: '9999' } as Listing;

    expect(resolveMarketplaceListingMetadata(legacy, [], [])).toEqual({ cardType: 'character', cardName: '諸伏高明', rarity: 'D', cardId: '0501' });
    expect(resolveMarketplaceListingMetadata(cardMasterOnly, [
      { key: 'case_1100', cardId: '1100', cardType: 'case', cardName: '緋色の真相', rarities: ['C'] },
    ], [])).toEqual({ cardType: 'case', cardName: '緋色の真相', rarity: 'C', cardId: '1100' });
    expect(resolveMarketplaceListingMetadata(missing, [], [])).toEqual({
      cardType: undefined,
      cardName: '未提供卡片名稱',
      rarity: '未提供稀有度',
      cardId: '9999',
    });
  });
});
