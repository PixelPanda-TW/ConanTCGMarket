import { useEffect, useState } from 'react';
import type { Card, Listing } from '../../domain/models';
import { getListing, getPublicSellerProfile, listCards } from '../../data/firestore/repositories';
import { useAuth } from '../auth/AuthProvider';
import { PageShell } from '../../components/PageShell';
import { CharacterSubscriptionControl } from '../notifications/CharacterSubscriptionControl';
import { ListingMetadata, resolveListingMetadata } from './ListingMetadata';

export function ListingPage({ id }: { id: string }) {
  const { user } = useAuth();
  const [listing, setListing] = useState<Listing | null>();
  const [card, setCard] = useState<Card | null>();
  const [seller, setSeller] = useState<{
    displayName: string;
    contactType: string;
    contactValue: string;
  } | null>();
  const [isKnownCharacter, setIsKnownCharacter] = useState(false);

  useEffect(() => {
    let isCurrent = true;
    setListing(undefined);
    setCard(undefined);
    setSeller(undefined);
    setIsKnownCharacter(false);

    void getListing(id)
      .then(async (value) => {
        if (!isCurrent) return;
        setListing(value);
        if (!value) return;
        const [cards, profile] = await Promise.all([
          listCards(),
          getPublicSellerProfile(value.sellerId),
        ]);
        if (!isCurrent) return;
        const resolvedCard = cards.find((item) => item.cardId === value.cardId) ?? null;
        const metadata = resolveListingMetadata(value, resolvedCard);
        setCard(resolvedCard);
        setIsKnownCharacter(Boolean(
          metadata.cardType === 'character'
          && cards.some((item) => item.cardType === 'character' && item.cardName === metadata.cardName),
        ));
        setSeller(profile);
      })
      .catch(() => {
        if (isCurrent) setListing(null);
      });

    return () => {
      isCurrent = false;
    };
  }, [id]);

  if (listing === undefined) {
    return <PageShell width="listing" backToMarketplace><p>商品載入中</p></PageShell>;
  }
  if (!listing || listing.status !== 'active') {
    return (
      <PageShell width="listing" backToMarketplace>
        <section className="listing-state"><h1>找不到商品</h1></section>
      </PageShell>
    );
  }
  const metadata = resolveListingMetadata(listing, card);
  return (
    <PageShell width="listing" backToMarketplace>
      <article className="listing-page">
        <header className="listing-page-header">
          <p className="eyebrow">商品詳情</p>
          <h1>商品詳情</h1>
          <ListingMetadata listing={listing} card={card} />
          {metadata.cardType === 'character' && (
            <CharacterSubscriptionControl
              characterName={metadata.cardName}
              isKnownCharacter={isKnownCharacter}
            />
          )}
          <p>商品詳情與聯絡資訊</p>
        </header>
        <div className="listing-page-layout">
          <div className="listing-images">
            {listing.imageUrls.map((url) => (
              <img key={url} src={url} alt={`${metadata.cardName} 實卡照片`} />
            ))}
          </div>
          <aside className="listing-purchase-panel">
            <p className="listing-price">
              NT${listing.listingPrice.toLocaleString('zh-TW')}<span>／張</span>
            </p>
            <p className="listing-stock">剩餘 {listing.remainingQuantity} 張</p>
            <div className="listing-tags">
              {listing.hasSleeve && (
                <span>
                  包手{listing.sleeveFee !== undefined ? `（包材費 NT$${listing.sleeveFee}）` : ''}
                </span>
              )}
              {listing.supportsMyShip && (
                <span>
                  支援賣貨便{listing.myShipFee !== undefined ? `（加價 NT$${listing.myShipFee}）` : ''}
                </span>
              )}
            </div>
            <hr />
            <p className="seller-label">賣家</p>
            <p className="seller-name">{seller?.displayName ?? '賣家'}</p>
            {seller ? (
              <a
                className="contact-link"
                href={seller.contactType === 'line' ? `https://line.me/ti/p/~${seller.contactValue}` : undefined}
                target="_blank"
                rel="noreferrer"
              >
                以 {seller.contactType} 聯絡：{seller.contactValue}
              </a>
            ) : <p>聯絡方式載入中</p>}
            {listing.note && <p className="listing-note">{listing.note}</p>}
            {user?.uid === listing.sellerId && (
              <a className="edit-listing-link" href={`#/listing/${id}/edit`}>管理此商品</a>
            )}
          </aside>
        </div>
      </article>
    </PageShell>
  );
}
