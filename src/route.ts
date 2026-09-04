export type AppRoute = 'marketplace' | 'profile' | 'sell' | 'dashboard' | 'notifications' | 'admin-cards';

export function canonicalHomeHash(hash: string): string {
  return hash === '#/' || hash === '#/cards' ? '#' : hash;
}

export function getAppRoute(hash: string): AppRoute {
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
