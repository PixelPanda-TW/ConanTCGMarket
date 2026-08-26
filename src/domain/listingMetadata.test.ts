import { describe, expect, it } from 'vitest';
import type { Card, Listing } from './models';
import { findCardsByVisibleId, resolveListingMetadata } from './listingMetadata';

const legacyListing = {
  cardId: '0501',
  rarity: undefined,
} as Listing;

const sharedCards: readonly Card[] = [
  { key: 'card_character', cardId: '0501', cardType: 'character', cardName: '諸伏高明', rarities: ['D'] },
  { key: 'card_event', cardId: '0501', cardType: 'event', cardName: '事件 0501', rarities: ['C'] },
];

describe('listing metadata resolution', () => {
  it('finds every canonical Card with a normalized visible ID', () => {
    expect(findCardsByVisibleId(sharedCards, ' 0501 ')).toEqual(sharedCards);
  });

  it('uses complete Listing snapshots before an ambiguous Card Master ID', () => {
    expect(resolveListingMetadata({
      ...legacyListing,
      cardType: 'partner',
      cardName: '上架快照',
      rarity: 'P',
    }, sharedCards)).toEqual({
      cardType: 'partner',
      cardName: '上架快照',
      rarity: 'P',
      cardId: '0501',
      resolution: 'snapshot',
    });
  });

  it('uses a legacy character snapshot before an ambiguous Card Master ID', () => {
    expect(resolveListingMetadata({
      ...legacyListing,
      characterName: '舊角色快照',
      rarity: 'R',
    }, sharedCards)).toEqual({
      cardType: 'character',
      cardName: '舊角色快照',
      rarity: 'R',
      cardId: '0501',
      resolution: 'legacy-character',
    });
  });

  it('uses Card Master metadata only when the visible ID has one candidate', () => {
    expect(resolveListingMetadata(legacyListing, [sharedCards[0]])).toEqual({
      cardType: 'character',
      cardName: '諸伏高明',
      rarity: 'D',
      cardId: '0501',
      resolution: 'card-master',
    });
  });

  it('reports shared Card Master IDs as ambiguous without choosing a candidate', () => {
    expect(resolveListingMetadata(legacyListing, sharedCards)).toEqual({
      cardType: undefined,
      cardName: '卡片資料不明確',
      rarity: '未提供稀有度',
      cardId: '0501',
      resolution: 'ambiguous',
    });
  });

  it('uses explicit missing labels when no Listing snapshot or Card candidate exists', () => {
    expect(resolveListingMetadata(legacyListing, [])).toEqual({
      cardType: undefined,
      cardName: '未提供卡片名稱',
      rarity: '未提供稀有度',
      cardId: '0501',
      resolution: 'missing',
    });
  });
});
