export type AppRoute = 'marketplace' | 'profile' | 'cards';

export function getAppRoute(hash: string): AppRoute {
  switch (hash.replace(/^#/, '')) {
    case '/profile':
      return 'profile';
    case '/cards':
      return 'cards';
    default:
      return 'marketplace';
  }
}
