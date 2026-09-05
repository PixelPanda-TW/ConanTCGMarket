import { useEffect, useRef, useState } from 'react';
import type { Card, Listing, PublicSellerProfile, SellerContact } from '../../domain/models';
import {
  getListing,
  getPublicSellerProfile,
  getSellerContact,
  listCards,
  republishSuspendedListing,
} from '../../data/firestore/repositories';
import { isKnownSubscriptionCardName } from '../../domain/cardNameSubscription';
import { useAuth } from '../auth/AuthProvider';
import { PageShell } from '../../components/PageShell';
import { CardNameSubscriptionControl } from '../notifications/CardNameSubscriptionControl';
import { SellerSubscriptionControl } from '../notifications/SellerSubscriptionControl';
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
  const republishPendingRef = useRef(false);
  const [republishPending, setRepublishPending] = useState(false);
  const [republishError, setRepublishError] = useState(false);
  const [republishSucceeded, setRepublishSucceeded] = useState(false);
  const contactScope = `${id}:${user?.uid ?? 'signed-out'}:${accountAccessState.state}`;
  const actionScope = contactScope;
  const actionScopeRef = useRef(actionScope);
  actionScopeRef.current = actionScope;

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
  }, [id, user?.uid]);

  useEffect(() => {
    contactRequestGeneration.current += 1;
    setContactState(null);
  }, [accountAccessState.state, id, user?.uid]);

  useEffect(() => {
    republishPendingRef.current = false;
    setRepublishPending(false);
    setRepublishError(false);
    setRepublishSucceeded(false);
  }, [actionScope]);

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

  async function republish() {
    if (!listing || listing.status !== 'suspended' || !listing.suspensionActionId
      || !isActiveAccount || user?.uid !== listing.sellerId || republishPendingRef.current
      || !window.confirm('確定要重新上架這筆商品嗎？請先確認價格與內容仍然正確。')) return;
    const scope = actionScope;
    republishPendingRef.current = true;
    setRepublishPending(true);
    setRepublishError(false);
    setRepublishSucceeded(false);
    try {
      await republishSuspendedListing({
        listingId: listing.id,
        suspensionActionId: listing.suspensionActionId,
      });
      if (actionScopeRef.current !== scope) return;
      const refreshed = await getListing(id);
      if (actionScopeRef.current !== scope) return;
      if (!refreshed || refreshed.id !== listing.id || refreshed.sellerId !== listing.sellerId
        || refreshed.status !== 'active') throw new Error();
      setListing(refreshed);
      setRepublishSucceeded(true);
    } catch {
      if (actionScopeRef.current === scope) setRepublishError(true);
    } finally {
      if (actionScopeRef.current === scope) {
        republishPendingRef.current = false;
        setRepublishPending(false);
      }
    }
  }

  if (listing === undefined) {
    return <PageShell width="listing" backToMarketplace><p>商品載入中</p></PageShell>;
  }
  const isOwner = Boolean(listing && user?.uid === listing.sellerId);
  if (!listing || (listing.status !== 'active' && !isOwner)) {
    return (
      <PageShell width="listing" backToMarketplace>
        <section className="listing-state"><h1>找不到商品</h1></section>
      </PageShell>
    );
  }
  const isSoldOut = listing.status === 'sold_out';
  const isHeld = listing.status === 'suspended';
  const isActiveListing = listing.status === 'active';
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
          {isActiveListing && hasResolvedCardName && (
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
            <p className="listing-stock">
              {isSoldOut
                ? '已售罄'
                : isHeld ? '因帳號停權暫停顯示' : `剩餘 ${listing.remainingQuantity} 張`}
            </p>
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
            {isActiveListing && seller !== undefined && (
              <SellerSubscriptionControl
                sellerId={listing.sellerId}
                sellerName={seller?.displayName ?? '賣家'}
              />
            )}
            {isSoldOut ? (
              <p className="contact-access-state" role="status">此商品已售罄，僅供賣家查看。</p>
            ) : isHeld ? (
              <p className="contact-access-state" role="status">此商品目前只供賣家本人查看。</p>
            ) : contact ? (
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
            {isActiveListing && !isOwner && (!user || isActiveAccount) && (
              <a className="report-listing-link" href={`#/listing/${id}/report`}>
                檢舉商品
              </a>
            )}
            {!isSoldOut && isActiveAccount && user?.uid === listing.sellerId && (
              <a className="edit-listing-link" href={`#/listing/${id}/edit`}>管理此商品</a>
            )}
            {isHeld && isActiveAccount && isOwner && (
              <button
                type="button"
                className="contact-reveal-button"
                disabled={republishPending}
                onClick={() => void republish()}
              >{republishPending ? '重新上架處理中' : '重新上架商品'}</button>
            )}
            {republishError && <p className="field-error" role="alert">無法重新上架商品，請稍後再試。</p>}
            {republishSucceeded && <p role="status">商品已重新上架。</p>}
          </aside>
        </div>
      </article>
    </PageShell>
  );
}
