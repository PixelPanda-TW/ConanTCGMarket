import { useEffect, useMemo, useState } from 'react';
import type { Card, Listing } from './domain/models';
import { AuthStatus } from './features/auth/AuthStatus';
import { CardMasterPage } from './features/cards/CardMasterPage';
import { SellerProfilePage } from './features/profile/SellerProfilePage';
import { SellPage } from './features/sell/SellPage';
import { ListingPage } from './features/listings/ListingPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { ListingEditPage } from './features/listings/ListingEditPage';
import {
  getCardIdsForMetadata,
  getCharacterNameSuggestions,
  getRaritiesForCharacter,
} from './features/sell/sellForm';
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
    characterName: '',
    rarity: '',
  });
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [cards, setCards] = useState<readonly Card[]>([]);
  const [showCharacterSuggestions, setShowCharacterSuggestions] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => { void Promise.all([listActiveListings(), listCards()]).then(async ([active, cards]) => {
    setCards(cards);
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

  const visibleListings = useMemo(() => filterListings(listings, filters), [filters, listings]);
  const characterSuggestions = useMemo(() => getCharacterNameSuggestions(cards, filters.characterName), [cards, filters.characterName]);
  const rarities = useMemo(() => getRaritiesForCharacter(cards, filters.characterName), [cards, filters.characterName]);
  const cardIds = useMemo(() => getCardIdsForMetadata(cards, filters.characterName, filters.rarity), [cards, filters.characterName, filters.rarity]);

  function updateCharacterName(characterName: string) {
    setFilters((current) => ({ ...current, characterName, rarity: '', cardId: '' }));
    setShowCharacterSuggestions(true);
  }

  function updateRarity(rarity: string) {
    setFilters((current) => ({ ...current, rarity, cardId: '' }));
  }

  return (
    <main className="app-shell">
      <section className="marketplace">
        <AuthStatus />
        <div className="masthead">
          <p className="eyebrow">Conan TCG Marketplace</p>
          <h1>搜尋正在販售的柯南 TCG 卡牌</h1>
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
            <div className="filter-autocomplete">
              <input aria-label="角色或人名篩選" value={filters.characterName} onChange={(event) => updateCharacterName(event.target.value)} onFocus={() => setShowCharacterSuggestions(true)} autoComplete="off" placeholder="輸入角色／人名" aria-controls="marketplace-character-options" aria-expanded={showCharacterSuggestions && characterSuggestions.length > 0} />
              {showCharacterSuggestions && characterSuggestions.length > 0 && (
                <ul className="character-suggestions" id="marketplace-character-options" aria-label="角色／人名候選">
                  {characterSuggestions.map((name) => (
                    <li key={name}>
                      <button type="button" onClick={() => {
                        setFilters((current) => ({ ...current, characterName: name, rarity: '', cardId: '' }));
                        setShowCharacterSuggestions(false);
                      }}>
                        {name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <select aria-label="稀有度篩選" value={filters.rarity} onChange={(event) => updateRarity(event.target.value)} disabled={!filters.characterName}>
              <option value="">全部稀有度</option>
              {rarities.map((rarity) => <option value={rarity} key={rarity}>{rarity}</option>)}
            </select>
            <select aria-label="卡片 ID 篩選" value={filters.cardId} onChange={(event) => setFilters((current) => ({ ...current, cardId: event.target.value }))} disabled={!filters.rarity}>
              <option value="">全部卡片 ID</option>
              {cardIds.map((cardId) => <option value={cardId} key={cardId}>{cardId}</option>)}
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

  return <Marketplace />;
}

export default App;
