import { useEffect, useRef, useState } from 'react';
import type { Card, Listing, PublicSellerProfile, SellerContact } from '../../domain/models';
import { getListing, getPublicSellerProfile, getSellerContact, listCards } from '../../data/firestore/repositories';
import { isKnownSubscriptionCardName } from '../../domain/cardNameSubscription';
import { useAuth } from '../auth/AuthProvider';
import { PageShell } from '../../components/PageShell';
import { CardNameSubscriptionControl } from '../notifications/CardNameSubscriptionControl';
import { ListingMetadata, resolveListingMetadata } from './ListingMetadata';
import { sellerContactPresentation } from '../../domain/sellerContact';

export function ListingPage({ id }: { id: string }) {
  const { accountAccessState, isActiveAccount, isLoading, signIn, user } = useAuth();
  const [listing, setListing] = useState<Listing | null>();
  const [cards, setCards] = useState<readonly Card[]>();
  const [seller, setSeller] = useState<PublicSellerProfile | null>();
  const [contactState, setContactState] = useState<{
    scope: string;
    status: 'loading' | 'revealed' | 'error';
    contact?: Pick<SellerContact, 'contactType' | 'contactValue'>;
    message?: string;
  } | null>(null);
  const contactRequestGeneration = useRef(0);
  const contactScope = `${id}:${user?.uid ?? 'signed-out'}:${accountAccessState.state}`;

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

  useEffect(() => {
    contactRequestGeneration.current += 1;
    setContactState(null);
  }, [accountAccessState.state, id, user?.uid]);

  async function revealContact() {
    if (!isActiveAccount || !user || contactState?.status === 'loading') return;
    const generation = ++contactRequestGeneration.current;
    const scope = contactScope;
    setContactState({ scope, status: 'loading' });
    try {
      const contact = await getSellerContact(id);
      if (contactRequestGeneration.current !== generation) return;
      setContactState({ scope, status: 'revealed', contact });
    } catch (error) {
      if (contactRequestGeneration.current !== generation) return;
      const isRateLimited = typeof error === 'object' && error !== null
        && 'code' in error && error.code === 'functions/resource-exhausted';
      setContactState({
        scope,
        status: 'error',
        message: isRateLimited
          ? '本時段查看次數已達上限，請稍後再試。'
          : '目前無法讀取聯絡方式，請稍後再試。',
      });
    }
  }

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
  const currentContactState = contactState?.scope === contactScope ? contactState : null;
  const contact = currentContactState?.status === 'revealed' && currentContactState.contact
    ? sellerContactPresentation(
        currentContactState.contact.contactType,
        currentContactState.contact.contactValue,
      )
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
            ) : isLoading || accountAccessState.state === 'loading' ? (
              <button type="button" className="contact-reveal-button" disabled>
                確認帳號狀態中
              </button>
            ) : !user ? (
              <button
                type="button"
                className="contact-reveal-button"
                onClick={() => { void signIn(); }}
              >
                登入後查看聯絡方式
              </button>
            ) : accountAccessState.state === 'suspended' ? (
              <p className="contact-access-state" role="status">帳號目前已停權，無法查看聯絡方式。</p>
            ) : accountAccessState.state === 'unavailable' ? (
              <p className="contact-access-state" role="status">無法確認帳號狀態，請重新整理後再試。</p>
            ) : currentContactState?.status === 'loading' ? (
              <button type="button" className="contact-reveal-button" disabled>
                讀取聯絡方式中
              </button>
            ) : (
              <>
                {currentContactState?.status === 'error' && (
                  <p className="field-error" role="alert">{currentContactState.message}</p>
                )}
                <button type="button" className="contact-reveal-button" onClick={revealContact}>
                  {currentContactState?.status === 'error' ? '重新查看聯絡方式' : '查看聯絡方式'}
                </button>
              </>
            )}
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
