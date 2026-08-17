export interface Sale {
  id: string;
  listingId: string;
  sellerId: string;
  cardId: string;
  quantity: number;
  listingUnitPrice: number;
  soldUnitPrice: number;
  soldAt: Date;
}

export function validateSale(sale: Sale) {
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
