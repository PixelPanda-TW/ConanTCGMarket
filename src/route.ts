export type AppRoute = 'marketplace' | 'profile' | 'cards' | 'sell' | 'dashboard' | 'notifications';

export function canonicalHomeHash(hash: string): string {
  return hash === '#/' ? '#' : hash;
}

export function getAppRoute(hash: string): AppRoute {
  switch (hash.replace(/^#/, '')) {
    case '/profile':
      return 'profile';
    case '/cards':
      return 'cards';
    case '/sell':
      return 'sell';
    case '/dashboard':
      return 'dashboard';
    case '/notifications':
      return 'notifications';
    default:
      return 'marketplace';
  }
}
