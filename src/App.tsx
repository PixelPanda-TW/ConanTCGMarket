import { useEffect, useMemo, useState } from 'react';
import type { Card, Listing } from './domain/models';
import { AuthStatus } from './features/auth/AuthStatus';
import { CardMasterPage } from './features/cards/CardMasterPage';
import { SellerProfilePage } from './features/profile/SellerProfilePage';
import { SellPage } from './features/sell/SellPage';
import { ListingPage } from './features/listings/ListingPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { ListingEditPage } from './features/listings/ListingEditPage';
import { filterListings } from './listingFilters';
import { canonicalHomeHash, getAppRoute } from './route';
import { getPublicSellerProfile, listActiveListings, listCards } from './data/firestore/repositories';
import { developmentCards } from './data/cards/developmentCards';
import { resolveListingCard } from './features/marketplace/marketplaceCatalog';

interface MarketplaceListing extends Listing { card: Card | null; characterName: string; seller: string; rarity: string; }

function Marketplace() {
  const [filters, setFilters] = useState({
    hasSleeve: false,
    supportsMyShip: false,
    cardId: '',
    rarity: '',
  });
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'price-asc' | 'price-desc'>('price-asc');
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => { void Promise.all([listActiveListings(), listCards()]).then(async ([active, cards]) => {
    const records = await Promise.all(active.filter((listing) => listing.status === 'active').map(async (listing) => ({ listing, card: resolveListingCard(listing.cardId, cards, developmentCards), profile: await getPublicSellerProfile(listing.sellerId) })));
    setListings(records.map(({ listing, card, profile }) => ({
      ...listing,
      card,
      characterName: listing.characterName ?? card?.characterName ?? card?.nameZh ?? card?.nameJa ?? '未提供角色／人名',
      rarity: listing.rarity ?? card?.rarity ?? '未提供稀有度',
      seller: profile?.displayName ?? '賣家',
    })));
    setState('ready');
  }).catch(() => setState('error')); }, []);

  const visibleListings = useMemo(() => filterListings(listings, filters).filter((listing) => listing.characterName.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a, b) => sort === 'price-asc' ? a.listingPrice - b.listingPrice : b.listingPrice - a.listingPrice), [filters, listings, query, sort]);
  const cards = useMemo(() => Array.from(new Map(listings.map((listing) => [listing.cardId, listing])).values()), [listings]);
  const rarities = useMemo(() => Array.from(new Set(listings.map((listing) => listing.rarity))).sort(), [listings]);

  return (
    <main className="app-shell">
      <section className="marketplace">
        <AuthStatus />
        <div className="masthead">
          <p className="eyebrow">Conan TCG Marketplace</p>
          <h1>搜尋正在販售的柯南 TCG 卡牌</h1>
          <div className="search-row">
            <input aria-label="搜尋卡牌" placeholder="搜尋中文或日文卡名" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <div className="filters" aria-label="篩選條件">
            <label>
              <input
                type="checkbox"
                checked={filters.hasSleeve}
                onChange={(event) =>
                  setFilters((currentFilters) => ({
                    ...currentFilters,
                    hasSleeve: event.target.checked,
                  }))
                }
              />
              包手
            </label>
            <label>
              <input
                type="checkbox"
                checked={filters.supportsMyShip}
                onChange={(event) =>
                  setFilters((currentFilters) => ({
                    ...currentFilters,
                    supportsMyShip: event.target.checked,
                  }))
                }
              />
              賣貨便
            </label>
            <select aria-label="價格排序" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
              <option value="price-asc">價格低到高</option>
              <option value="price-desc">價格高到低</option>
            </select>
            <select aria-label="卡名篩選" value={filters.cardId} onChange={(event) => setFilters((current) => ({ ...current, cardId: event.target.value }))}>
              <option value="">全部卡名</option>
              {cards.map((card) => <option value={card.cardId} key={card.cardId}>{card.characterName}</option>)}
            </select>
            <select aria-label="稀有度篩選" value={filters.rarity} onChange={(event) => setFilters((current) => ({ ...current, rarity: event.target.value }))}>
              <option value="">全部稀有度</option>
              {rarities.map((rarity) => <option value={rarity} key={rarity}>{rarity}</option>)}
            </select>
          </div>
        </div>

        <section className="listings" aria-label="商品列表">
          {state === 'loading' && <p>商品載入中</p>}
          {state === 'error' && <p role="alert">無法載入商品，請稍後再試。</p>}
          {state === 'ready' && visibleListings.length === 0 && <p>目前沒有符合條件的商品。</p>}
          {visibleListings.map((listing) => (
            <a className="listing-card" href={`#/listing/${listing.id}`} key={listing.id}>
              <img className="card-photo" src={listing.imageUrls[0]} alt="實卡照片" />
              <div className="listing-details">
                <h2>{listing.characterName}</h2>
                <p className="rarity">{listing.rarity}</p>
                <p className="price">NT${listing.listingPrice.toLocaleString('zh-TW')} / 張</p>
                <p>剩餘 {listing.remainingQuantity} 張</p>
                <p>賣家：{listing.seller}</p>
                <div className="badges">
                  {listing.hasSleeve && <span>包手</span>}
                  {listing.supportsMyShip && <span>賣貨便</span>}
                </div>
              </div>
            </a>
          ))}
        </section>
      </section>
    </main>
  );
}

function App() {
  const [route, setRoute] = useState(() => getAppRoute(window.location.hash));

  useEffect(() => {
    if (canonicalHomeHash(window.location.hash) !== window.location.hash) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#`);
    }
    const updateRoute = () => setRoute(getAppRoute(window.location.hash));
    window.addEventListener('hashchange', updateRoute);
    return () => window.removeEventListener('hashchange', updateRoute);
  }, []);

  const listingEditMatch = window.location.hash.match(/^#\/listing\/([^/]+)\/edit$/);
  if (listingEditMatch) return <ListingEditPage id={listingEditMatch[1]} />;
  const listingMatch = window.location.hash.match(/^#\/listing\/([^/]+)$/);
  if (listingMatch) return <ListingPage id={listingMatch[1]} />;

  if (route === 'profile') {
    return <SellerProfilePage />;
  }

  if (route === 'cards') {
    return <CardMasterPage />;
  }
  if (route === 'sell') return <SellPage />;
  if (route === 'dashboard') return <DashboardPage />;

  return <Marketplace />;
}

export default App;
