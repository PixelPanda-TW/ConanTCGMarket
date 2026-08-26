import { describe, expect, it } from 'vitest';
import type { Card, Listing } from '../../domain/models';
import { resolveMarketplaceListingMetadata } from './marketplaceCatalog';

const legacyListing = { cardId: '0501' } as Listing;
const characterCard: Card = {
  key: 'card_character',
  cardId: '0501',
  cardType: 'character',
  cardName: '諸伏高明',
  rarities: ['D'],
};
const eventCard: Card = {
  key: 'card_event',
  cardId: '0501',
  cardType: 'event',
  cardName: '事件 0501',
  rarities: ['C'],
};

describe('resolveMarketplaceListingMetadata', () => {
  it('uses development fallback candidates when Firestore has none for the visible ID', () => {
    expect(resolveMarketplaceListingMetadata(legacyListing, [], [characterCard])).toEqual({
      cardType: 'character',
      cardName: '諸伏高明',
      rarity: 'D',
      cardId: '0501',
      resolution: 'card-master',
    });
  });

  it('uses complete Listing snapshots before legacy and Card Master data', () => {
    const listing = {
      cardId: '0501', cardType: 'partner', cardName: '上架快照', rarity: 'P', characterName: '舊角色',
    } as Listing;

    expect(resolveMarketplaceListingMetadata(listing, [characterCard, eventCard], [])).toEqual({
      cardType: 'partner',
      cardName: '上架快照',
      rarity: 'P',
      cardId: '0501',
      resolution: 'snapshot',
    });
  });

  it('prefers every Firestore candidate over development fallback cards for the same visible ID', () => {
    expect(resolveMarketplaceListingMetadata(legacyListing, [eventCard], [characterCard])).toEqual({
      cardType: 'event',
      cardName: '事件 0501',
      rarity: 'C',
      cardId: '0501',
      resolution: 'card-master',
    });

    expect(resolveMarketplaceListingMetadata(legacyListing, [characterCard, eventCard], [])).toEqual({
      cardType: undefined,
      cardName: '卡片資料不明確',
      rarity: '未提供稀有度',
      cardId: '0501',
      resolution: 'ambiguous',
    });
  });

  it('uses explicit missing labels when no candidate exists', () => {
    expect(resolveMarketplaceListingMetadata({ cardId: '9999' } as Listing, [], [])).toEqual({
      cardType: undefined,
      cardName: '未提供卡片名稱',
      rarity: '未提供稀有度',
      cardId: '9999',
      resolution: 'missing',
    });
  });
});
