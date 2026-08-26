import { useEffect, useMemo, useState } from 'react';
import { CardMetadataSelector, type CardMetadataSelection } from '../../components/CardMetadataSelector';
import { PageShell } from '../../components/PageShell';
import { WelcomeNoticeDialog } from '../../components/WelcomeNoticeDialog';
import { developmentCards } from '../../data/cards/developmentCards';
import { getPublicSellerProfile, listActiveListings, listCards } from '../../data/firestore/repositories';
import type { Card, Listing, SellerProfile } from '../../domain/models';
import { filterListings } from '../../listingFilters';
import { AuthStatus } from '../auth/AuthStatus';
import { CharacterSubscriptionControl } from '../notifications/CharacterSubscriptionControl';
import { resolveListingCard } from './marketplaceCatalog';

interface MarketplaceListing extends Listing {
  card: Card | null;
  characterName: string;
  rarity: string;
  seller: string;
}

type PublicSellerProfile = Pick<SellerProfile, 'displayName' | 'contactType' | 'contactValue'>;

export interface MarketplacePageProps {
  loadListings?: () => Promise<Listing[]>;
  loadCards?: () => Promise<Card[]>;
  loadSeller?: (sellerId: string) => Promise<PublicSellerProfile | null>;
}

const initialMetadata: CardMetadataSelection = {
  characterName: '',
  rarity: '',
  cardId: '',
};

export function MarketplacePage({
  loadListings = listActiveListings,
  loadCards = listCards,
  loadSeller = getPublicSellerProfile,
}: MarketplacePageProps) {
  const [filters, setFilters] = useState({
    hasSleeve: false,
    supportsMyShip: false,
    ...initialMetadata,
  });
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [cards, setCards] = useState<readonly Card[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let isCurrent = true;

    void Promise.all([loadListings(), loadCards()])
      .then(async ([activeListings, loadedCards]) => {
        const records = await Promise.all(
          activeListings
            .filter((listing) => listing.status === 'active')
            .map(async (listing) => ({
              listing,
              card: resolveListingCard(listing.cardId, loadedCards, developmentCards),
              profile: await loadSeller(listing.sellerId),
            })),
        );

        if (!isCurrent) return;
        setCards(loadedCards);
        setListings(records.map(({ listing, card, profile }) => ({
          ...listing,
          card,
          characterName: listing.characterName ?? card?.cardName ?? '未提供角色／人名',
          rarity: listing.rarity ?? card?.rarities[0] ?? '未提供稀有度',
          seller: profile?.displayName ?? '賣家',
        })));
        setState('ready');
      })
      .catch(() => {
        if (isCurrent) setState('error');
      });

    return () => { isCurrent = false; };
  }, [loadCards, loadListings, loadSeller]);

  const visibleListings = useMemo(() => filterListings(listings, filters), [filters, listings]);
  const isKnownCharacter = cards.some((card) => card.cardType === 'character' && card.cardName === filters.characterName);

  return (
    <PageShell width="marketplace">
      <WelcomeNoticeDialog />
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
                onChange={(event) => setFilters((current) => ({ ...current, hasSleeve: event.target.checked }))}
              />
              包手
            </label>
            <label>
              <input
                type="checkbox"
                checked={filters.supportsMyShip}
                onChange={(event) => setFilters((current) => ({ ...current, supportsMyShip: event.target.checked }))}
              />
              賣貨便
            </label>
            <CardMetadataSelector
              cards={cards}
              value={filters}
              onChange={(metadata) => setFilters((current) => ({ ...current, ...metadata }))}
              requireCardId={false}
              className="marketplace-card-metadata-selector"
            />
          </div>
          {isKnownCharacter && (
            <section className="marketplace-subscription" aria-label="角色通知">
              <p>想第一時間知道「{filters.characterName}」的新商品？</p>
              <CharacterSubscriptionControl
                characterName={filters.characterName ?? ''}
                isKnownCharacter
              />
            </section>
          )}
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
    </PageShell>
  );
}
