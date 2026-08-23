export function summarizeDashboard(
  listings: readonly { status: string }[],
  sales: readonly { quantity: number; soldUnitPrice: number }[],
) {
  return {
    activeCount: listings.filter((listing) => listing.status === 'active').length,
    soldQuantity: sales.reduce((total, sale) => total + sale.quantity, 0),
    revenue: sales.reduce((total, sale) => total + sale.quantity * sale.soldUnitPrice, 0),
  };
}
