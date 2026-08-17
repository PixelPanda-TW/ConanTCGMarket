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
  if (!sale.id) {
    throw new Error('Sale requires id.');
  }

  if (!sale.listingId) {
    throw new Error('Sale requires listingId.');
  }

  if (!sale.sellerId) {
    throw new Error('Sale requires sellerId.');
  }

  if (!sale.cardId) {
    throw new Error('Sale requires cardId.');
  }

  if (sale.quantity <= 0) {
    throw new Error('Sale quantity must be greater than 0.');
  }

  if (sale.listingUnitPrice <= 0) {
    throw new Error('Sale listingUnitPrice must be greater than 0.');
  }

  if (sale.soldUnitPrice <= 0) {
    throw new Error('Sale soldUnitPrice must be greater than 0.');
  }
}
