import { useEffect, useState } from 'react';
import { CardMasterPage } from './features/cards/CardMasterPage';
import { SellerProfilePage } from './features/profile/SellerProfilePage';
import { SellPage } from './features/sell/SellPage';
import { ListingPage } from './features/listings/ListingPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { ListingEditPage } from './features/listings/ListingEditPage';
import { canonicalHomeHash, getAppRoute } from './route';
import { MarketplacePage } from './features/marketplace/MarketplacePage';
import { NotificationSettingsPage } from './features/notifications/NotificationSettingsPage';

function App() {
  const [hash, setHash] = useState(() => canonicalHomeHash(window.location.hash));

  useEffect(() => {
    const updateHash = () => {
      const nextHash = canonicalHomeHash(window.location.hash);
      if (nextHash !== window.location.hash) {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${nextHash}`);
      }
      setHash(nextHash);
    };
    updateHash();
    window.addEventListener('hashchange', updateHash);
    return () => window.removeEventListener('hashchange', updateHash);
  }, []);

  const route = getAppRoute(hash);
  const listingEditMatch = hash.match(/^#\/listing\/([^/]+)\/edit$/);
  if (listingEditMatch) return <ListingEditPage id={listingEditMatch[1]} />;
  const listingMatch = hash.match(/^#\/listing\/([^/]+)$/);
  if (listingMatch) return <ListingPage id={listingMatch[1]} />;

  if (route === 'profile') {
    return <SellerProfilePage />;
  }

  if (route === 'cards') {
    return <CardMasterPage />;
  }
  if (route === 'sell') return <SellPage />;
  if (route === 'dashboard') return <DashboardPage />;
  if (route === 'notifications') return <NotificationSettingsPage />;

  return <MarketplacePage />;
}

export default App;
