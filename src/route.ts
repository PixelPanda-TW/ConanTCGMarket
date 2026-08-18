export type AppRoute = 'marketplace' | 'profile';

export function getAppRoute(hash: string): AppRoute {
  return hash.replace(/^#/, '') === '/profile' ? 'profile' : 'marketplace';
}
