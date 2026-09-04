import { describe, expect, it } from 'vitest';
import type { Card, Listing, Sale } from '../../domain/models';
import {
  resolveSaleHistoryMetadata,
  saleLineTotal,
  sortSalesNewestFirst,
  formatTaipeiSaleDate,
} from './salesHistory';

const current = (overrides: Partial<Sale> = {}): Sale => ({
  id: 'sale-b', listingId: 'listing-1', sellerId: 'seller-1', cardId: '2200',
  cardType: 'case', cardName: '封鎖現場', rarity: 'SR', quantity: 2,
  listingUnitPrice: 500, soldUnitPrice: 450,
  soldAt: new Date('2026-08-17T01:00:00.000Z'), ...overrides,
});

const listing: Listing = {
  id: 'listing-1', sellerId: 'seller-1', cardId: '1100', cardType: 'event',
  cardName: '舊版事件', rarity: 'CP', imageUrls: ['https://example.com/card.jpg'],
  listingPrice: 500, originalQuantity: 2, remainingQuantity: 0, hasSleeve: false,
  supportsMyShip: false, status: 'sold_out', createdAt: new Date(), updatedAt: new Date(),
};

const cards: Card[] = [
  { key: 'event-1100', cardId: '1100', cardType: 'event', cardName: '舊版事件', rarities: ['CP'] },
];

describe('sales history', () => {
  it('sorts newest first and uses descending ID as a stable tie-breaker', () => {
    const sales = [
      current({ id: 'sale-a' }),
      current({ id: 'sale-c', soldAt: new Date('2026-08-16T00:00:00.000Z') }),
      current({ id: 'sale-b' }),
    ];

    expect(sortSalesNewestFirst(sales).map((sale) => sale.id)).toEqual([
      'sale-b', 'sale-a', 'sale-c',
    ]);
    expect(sales.map((sale) => sale.id)).toEqual(['sale-a', 'sale-c', 'sale-b']);
  });

  it('uses immutable Sale snapshots and computes the line total from actual price', () => {
    const sale = current();
    expect(resolveSaleHistoryMetadata(sale, [], [])).toEqual({
      cardType: 'case', cardName: '封鎖現場', rarity: 'SR', cardId: '2200',
      resolution: 'snapshot', listingExists: false,
    });
    expect(saleLineTotal(sale)).toBe(900);
  });

  it('resolves a recognized legacy Sale from its retained Listing without guessing', () => {
    const legacy = current({
      id: 'legacy', cardId: '1100', cardType: undefined, cardName: undefined, rarity: undefined,
    });

    expect(resolveSaleHistoryMetadata(legacy, [listing], cards)).toEqual({
      cardType: 'event', cardName: '舊版事件', rarity: 'CP', cardId: '1100',
      resolution: 'listing', listingExists: true,
    });
  });

  it('labels missing and ambiguous legacy metadata instead of selecting a card', () => {
    const legacy = current({
      id: 'legacy', listingId: 'missing', cardId: '0501',
      cardType: undefined, cardName: undefined, rarity: undefined,
    });
    const ambiguousCards: Card[] = [
      { key: 'character', cardId: '0501', cardType: 'character', cardName: '諸伏高明', rarities: ['D'] },
      { key: 'event', cardId: '0501', cardType: 'event', cardName: '事件 0501', rarities: ['C'] },
    ];

    expect(resolveSaleHistoryMetadata(legacy, [], ambiguousCards)).toEqual({
      cardType: undefined, cardName: '卡片資料不明確', rarity: '未提供稀有度',
      cardId: '0501', resolution: 'ambiguous', listingExists: false,
    });
    expect(resolveSaleHistoryMetadata({ ...legacy, cardId: '9999' }, [], [])).toEqual({
      cardType: undefined, cardName: '未提供卡片名稱', rarity: '未提供稀有度',
      cardId: '9999', resolution: 'missing', listingExists: false,
    });
  });

  it('formats the sale timestamp explicitly in Asia/Taipei', () => {
    expect(formatTaipeiSaleDate(new Date('2026-09-04T08:30:00.000Z')))
      .toBe('2026/09/04 16:30');
  });
});
