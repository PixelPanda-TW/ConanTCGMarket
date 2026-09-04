import { isCardType, type CardType } from '../cardType';

export interface Sale {
  id: string;
  listingId: string;
  sellerId: string;
  cardId: string;
  cardType?: CardType;
  cardName?: string;
  rarity?: string;
  quantity: number;
  listingUnitPrice: number;
  soldUnitPrice: number;
  soldAt: Date;
}

export function validateSale(sale: Sale, allowLegacySnapshot = false) {
  if (typeof sale.id !== 'string' || sale.id.length === 0) {
    throw new Error('Sale requires id.');
  }

  if (typeof sale.listingId !== 'string' || sale.listingId.length === 0) {
    throw new Error('Sale requires listingId.');
  }

  if (typeof sale.sellerId !== 'string' || sale.sellerId.length === 0) {
    throw new Error('Sale requires sellerId.');
  }

  if (typeof sale.cardId !== 'string' || sale.cardId.length === 0) {
    throw new Error('Sale requires cardId.');
  }

  const snapshotValues = [sale.cardType, sale.cardName, sale.rarity];
  const hasAnySnapshot = snapshotValues.some((value) => value !== undefined);
  const hasCanonicalSnapshot = isCardType(sale.cardType)
    && typeof sale.cardName === 'string'
    && sale.cardName.length > 0
    && sale.cardName === sale.cardName.trim()
    && typeof sale.rarity === 'string'
    && sale.rarity.length > 0
    && sale.rarity === sale.rarity.trim();
  if (!hasCanonicalSnapshot && (hasAnySnapshot || !allowLegacySnapshot)) {
    if (typeof sale.cardName === 'string' && sale.cardName !== sale.cardName.trim()) {
      throw new Error('Sale card snapshot values must be trimmed.');
    }
    throw new Error('Sale requires a complete canonical card snapshot.');
  }

  if (!Number.isInteger(sale.quantity) || sale.quantity <= 0) {
    throw new Error('Sale quantity must be greater than 0.');
  }

  if (!Number.isFinite(sale.listingUnitPrice) || sale.listingUnitPrice <= 0) {
    throw new Error('Sale listingUnitPrice must be greater than 0.');
  }

  if (!Number.isFinite(sale.soldUnitPrice) || sale.soldUnitPrice <= 0) {
    throw new Error('Sale soldUnitPrice must be greater than 0.');
  }

  if (!(sale.soldAt instanceof Date) || Number.isNaN(sale.soldAt.valueOf())) {
    throw new Error('Sale requires a valid soldAt date.');
  }
}
