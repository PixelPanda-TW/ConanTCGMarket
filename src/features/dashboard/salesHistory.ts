import { findCardsByVisibleId, resolveListingMetadata } from '../../domain/listingMetadata';
import type { Card, Listing, Sale } from '../../domain/models';
import type { CardType } from '../../domain/cardType';

export interface SaleHistoryMetadata {
  cardType?: CardType;
  cardName: string;
  rarity: string;
  cardId: string;
  resolution: 'snapshot' | 'listing' | 'card-master' | 'ambiguous' | 'missing';
  listingExists: boolean;
}

export function sortSalesNewestFirst(sales: readonly Sale[]): Sale[] {
  return [...sales].sort((left, right) => {
    const timestampDifference = right.soldAt.valueOf() - left.soldAt.valueOf();
    return timestampDifference || right.id.localeCompare(left.id);
  });
}

export function saleLineTotal(sale: Pick<Sale, 'quantity' | 'soldUnitPrice'>): number {
  return sale.quantity * sale.soldUnitPrice;
}

export function formatTaipeiSaleDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}/${value('month')}/${value('day')} ${value('hour')}:${value('minute')}`;
}

export function resolveSaleHistoryMetadata(
  sale: Sale,
  listings: readonly Listing[],
  cards: readonly Card[],
): SaleHistoryMetadata {
  if (sale.cardType && sale.cardName && sale.rarity) {
    return {
      cardType: sale.cardType,
      cardName: sale.cardName,
      rarity: sale.rarity,
      cardId: sale.cardId,
      resolution: 'snapshot',
      listingExists: listings.some((listing) => listing.id === sale.listingId),
    };
  }

  const listing = listings.find((candidate) => candidate.id === sale.listingId);
  if (listing) {
    const metadata = resolveListingMetadata(listing, cards);
    return {
      cardType: metadata.cardType,
      cardName: metadata.cardName,
      rarity: metadata.rarity,
      cardId: metadata.cardId,
      resolution: metadata.resolution === 'ambiguous' || metadata.resolution === 'missing'
        ? metadata.resolution
        : 'listing',
      listingExists: true,
    };
  }

  const candidates = findCardsByVisibleId(cards, sale.cardId);
  if (candidates.length === 1) {
    return {
      cardType: candidates[0].cardType,
      cardName: candidates[0].cardName,
      rarity: candidates[0].rarities.length === 1
        ? candidates[0].rarities[0]
        : '未提供稀有度',
      cardId: sale.cardId,
      resolution: 'card-master',
      listingExists: false,
    };
  }

  return {
    cardType: undefined,
    cardName: candidates.length > 1 ? '卡片資料不明確' : '未提供卡片名稱',
    rarity: '未提供稀有度',
    cardId: sale.cardId,
    resolution: candidates.length > 1 ? 'ambiguous' : 'missing',
    listingExists: false,
  };
}
