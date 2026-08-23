export type AppRoute = 'marketplace' | 'profile' | 'cards' | 'sell';

export function getAppRoute(hash: string): AppRoute {
  switch (hash.replace(/^#/, '')) {
    case '/profile':
      return 'profile';
    case '/cards':
      return 'cards';
    case '/sell':
      return 'sell';
    default:
      return 'marketplace';
  }
}
