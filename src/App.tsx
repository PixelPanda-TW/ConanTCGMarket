import { useEffect, useMemo, useState } from 'react';
import { AuthStatus } from './features/auth/AuthStatus';
import { CardMasterPage } from './features/cards/CardMasterPage';
import { SellerProfilePage } from './features/profile/SellerProfilePage';
import { filterListings } from './listingFilters';
import { getAppRoute } from './route';

const sampleListings = [
  {
    cardName: '諸伏景光',
    rarity: 'CP',
    price: 500,
    remaining: 5,
    seller: 'ABC',
    hasSleeve: true,
    supportsMyShip: true,
  },
  {
    cardName: '江戶川柯南',
    rarity: 'SR',
    price: 320,
    remaining: 2,
    seller: 'Detective Shop',
    hasSleeve: true,
    supportsMyShip: false,
  },
];

function Marketplace() {
  const [filters, setFilters] = useState({
    hasSleeve: false,
    supportsMyShip: false,
  });

  const visibleListings = useMemo(() => filterListings(sampleListings, filters), [filters]);

  return (
    <main className="app-shell">
      <section className="marketplace">
        <AuthStatus />
        <div className="masthead">
          <p className="eyebrow">Conan TCG Marketplace</p>
          <h1>搜尋正在販售的柯南 TCG 卡牌</h1>
          <div className="search-row">
            <input aria-label="搜尋卡牌" placeholder="搜尋中文或日文卡名" />
            <button type="button">搜尋</button>
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
            <select aria-label="價格排序" defaultValue="price-asc">
              <option value="price-asc">價格低到高</option>
              <option value="price-desc">價格高到低</option>
            </select>
          </div>
        </div>

        <section className="listings" aria-label="商品列表">
          {visibleListings.map((listing) => (
            <article className="listing-card" key={`${listing.cardName}-${listing.rarity}`}>
              <div className="card-photo" aria-hidden="true">
                CARD
              </div>
              <div className="listing-details">
                <h2>{listing.cardName}</h2>
                <p className="rarity">{listing.rarity}</p>
                <p className="price">NT${listing.price.toLocaleString('zh-TW')} / 張</p>
                <p>剩餘 {listing.remaining} 張</p>
                <p>賣家：{listing.seller}</p>
                <div className="badges">
                  {listing.hasSleeve && <span>包手</span>}
                  {listing.supportsMyShip && <span>賣貨便</span>}
                </div>
              </div>
            </article>
          ))}
        </section>
      </section>
    </main>
  );
}

function App() {
  const [route, setRoute] = useState(() => getAppRoute(window.location.hash));

  useEffect(() => {
    const updateRoute = () => setRoute(getAppRoute(window.location.hash));
    window.addEventListener('hashchange', updateRoute);
    return () => window.removeEventListener('hashchange', updateRoute);
  }, []);

  if (route === 'profile') {
    return <SellerProfilePage />;
  }

  if (route === 'cards') {
    return <CardMasterPage />;
  }

  return <Marketplace />;
}

export default App;
