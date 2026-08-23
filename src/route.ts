export type AppRoute = 'marketplace' | 'profile' | 'cards' | 'sell' | 'dashboard';

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
    default:
      return 'marketplace';
  }
}
