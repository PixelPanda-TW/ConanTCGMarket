export type AppRoute = 'marketplace' | 'profile' | 'sell' | 'dashboard' | 'notifications'
  | 'admin-cards' | 'admin-moderation' | 'admin-moderation-case' | 'listing-report';

const REPORT_LISTING_PATTERN = /^#\/listing\/([A-Za-z0-9_-]{1,200})\/report$/u;
const MODERATION_CASE_PATTERN = /^#\/admin\/moderation\/([A-Za-z0-9_-]{1,200})$/u;

export function getReportListingId(hash: string): string | null {
  return hash.match(REPORT_LISTING_PATTERN)?.[1] ?? null;
}

export function getModerationCaseId(hash: string): string | null {
  return hash.match(MODERATION_CASE_PATTERN)?.[1] ?? null;
}

export function canonicalHomeHash(hash: string): string {
  return hash === '#/' || hash === '#/cards' ? '#' : hash;
}

export function getAppRoute(hash: string): AppRoute {
  if (getModerationCaseId(hash)) return 'admin-moderation-case';
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
    case '/admin/moderation':
      return 'admin-moderation';
    default:
      return 'marketplace';
  }
}
