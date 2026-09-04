export type AppRoute = 'marketplace' | 'profile' | 'sell' | 'dashboard' | 'notifications' | 'admin-cards' | 'listing-report';

const REPORT_LISTING_PATTERN = /^#\/listing\/([A-Za-z0-9_-]{1,200})\/report$/u;

export function getReportListingId(hash: string): string | null {
  return hash.match(REPORT_LISTING_PATTERN)?.[1] ?? null;
}

export function canonicalHomeHash(hash: string): string {
  return hash === '#/' || hash === '#/cards' ? '#' : hash;
}

export function getAppRoute(hash: string): AppRoute {
  if (getReportListingId(hash)) return 'listing-report';
  switch (hash.replace(/^#/, '')) {
    case '/profile':
      return 'profile';
    case '/sell':
      return 'sell';
    case '/dashboard':
      return 'dashboard';
    case '/notifications':
      return 'notifications';
    case '/admin/cards':
      return 'admin-cards';
    default:
      return 'marketplace';
  }
}
