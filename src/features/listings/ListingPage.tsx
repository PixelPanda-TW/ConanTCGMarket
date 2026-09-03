import { useEffect, useState } from 'react';
import type { Card, Listing, SellerProfile } from '../../domain/models';
import { getListing, getPublicSellerProfile, listCards } from '../../data/firestore/repositories';
import { isKnownSubscriptionCardName } from '../../domain/cardNameSubscription';
import { useAuth } from '../auth/AuthProvider';
import { PageShell } from '../../components/PageShell';
import { CardNameSubscriptionControl } from '../notifications/CardNameSubscriptionControl';
import { ListingMetadata, resolveListingMetadata } from './ListingMetadata';
import { sellerContactPresentation } from '../../domain/sellerContact';

export function ListingPage({ id }: { id: string }) {
  const { isActiveAccount, user } = useAuth();
  const [listing, setListing] = useState<Listing | null>();
  const [cards, setCards] = useState<readonly Card[]>();
  const [seller, setSeller] = useState<Pick<
    SellerProfile,
    'displayName' | 'contactType' | 'contactValue'
  > | null>();

  useEffect(() => {
    let isCurrent = true;
    setListing(undefined);
    setCards(undefined);
    setSeller(undefined);

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
        setCards(cards);
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
  const metadata = resolveListingMetadata(listing, cards ?? []);
  const hasResolvedCardName = metadata.resolution !== 'ambiguous'
    && metadata.resolution !== 'missing';
  const isKnownCardName = hasResolvedCardName
    && isKnownSubscriptionCardName(cards ?? [], metadata.cardName);
  const contact = seller
    ? sellerContactPresentation(seller.contactType, seller.contactValue)
    : undefined;
  return (
    <PageShell width="listing" backToMarketplace>
      <article className="listing-page">
        <header className="listing-page-header">
          <p className="eyebrow">商品詳情</p>
          <h1>商品詳情</h1>
          <ListingMetadata listing={listing} cards={cards} />
          {hasResolvedCardName && (
            <CardNameSubscriptionControl
              cardName={metadata.cardName}
              isKnownCardName={isKnownCardName}
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
            {contact ? (
              contact.href ? (
                <a
                  className="contact-link"
                  href={contact.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  {contact.label}{contact.value ? `：${contact.value}` : ''}
                </a>
              ) : (
                <p className="contact-value">
                  {contact.label}{contact.value ? `：${contact.value}` : ''}
                </p>
              )
            ) : <p>聯絡方式載入中</p>}
            {listing.note && <p className="listing-note">{listing.note}</p>}
            {isActiveAccount && user?.uid === listing.sellerId && (
              <a className="edit-listing-link" href={`#/listing/${id}/edit`}>管理此商品</a>
            )}
          </aside>
        </div>
      </article>
    </PageShell>
  );
}
