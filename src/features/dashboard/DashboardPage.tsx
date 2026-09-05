import { useEffect, useRef, useState } from 'react';
import type { Card, Listing, Sale } from '../../domain/models';
import {
  listCards,
  listSellerListings,
  listSellerSales,
  recordSale,
} from '../../data/firestore/repositories';
import { PageShell } from '../../components/PageShell';
import { AccountAccessNotice } from '../auth/AccountAccessNotice';
import { useAuth } from '../auth/AuthProvider';
import { ListingMetadata } from '../listings/ListingMetadata';
import { summarizeDashboard } from './dashboardSummary';
import { cardTypeLabel } from '../../domain/cardType';
import {
  formatTaipeiSaleDate,
  resolveSaleHistoryMetadata,
  saleLineTotal,
  sortSalesNewestFirst,
} from './salesHistory';

export function DashboardPage() {
  const { accountAccessState, isActiveAccount, isLoading: isAuthLoading, user } = useAuth();
  const [cards, setCards] = useState<Card[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loadedUid, setLoadedUid] = useState<string | null>(null);
  const [reloadAttempt, setReloadAttempt] = useState(0);
  const [selected, setSelected] = useState<Listing | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSalePending, setIsSalePending] = useState(false);
  const salePending = useRef(false);
  const canReadHistory = accountAccessState.state === 'active'
    || accountAccessState.state === 'suspended';
  const currentUid = user?.uid ?? null;

  useEffect(() => {
    let isCurrent = true;
    setCards([]);
    setListings([]);
    setSales([]);
    setLoadedUid(null);
    setSelected(null);
    setError(null);
    setIsSalePending(false);
    salePending.current = false;

    if (!currentUid || !canReadHistory) {
      return () => { isCurrent = false; };
    }

    void Promise.all([
      listSellerListings(currentUid),
      listSellerSales(currentUid),
      listCards().catch(() => []),
    ]).then(([nextListings, nextSales, nextCards]) => {
      if (!isCurrent) return;
      setListings(nextListings);
      setSales(nextSales);
      setCards(nextCards);
      setLoadedUid(currentUid);
    }).catch(() => {
      if (!isCurrent) return;
      setError('無法載入賣家資料。');
      setLoadedUid(currentUid);
    });

    return () => { isCurrent = false; };
  }, [canReadHistory, currentUid, reloadAttempt]);

  if (isAuthLoading) {
    return <PageShell backToMarketplace><p>載入中</p></PageShell>;
  }
  if (!user) {
    return (
      <PageShell backToMarketplace>
        <h1>賣家管理</h1>
        <p>請先登入才能管理商品。</p>
      </PageShell>
    );
  }
  if (!canReadHistory) {
    return (
      <PageShell backToMarketplace>
        <section className="profile-page dashboard-page">
          <h1>賣家管理</h1>
          <AccountAccessNotice state={accountAccessState} />
        </section>
      </PageShell>
    );
  }

  const isDataLoading = loadedUid !== currentUid;
  const summary = summarizeDashboard(listings, sales);
  const salesHistory = sortSalesNewestFirst(sales);

  async function submitSale() {
    if (!selected || !isActiveAccount || salePending.current) return;
    const count = Number(quantity);
    const unit = Number(price);
    if (!Number.isInteger(count)
      || count < 1
      || count > selected.remainingQuantity
      || !Number.isFinite(unit)
      || unit <= 0) {
      setError('成交數量或價格不正確。');
      return;
    }
    salePending.current = true;
    setIsSalePending(true);
    try {
      await recordSale(selected.id, count, unit);
      setSelected(null);
      setError(null);
      setReloadAttempt((attempt) => attempt + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '無法登記成交。');
    } finally {
      salePending.current = false;
      setIsSalePending(false);
    }
  }

  return (
    <PageShell backToMarketplace>
      <section className="profile-page dashboard-page">
        <p className="eyebrow">Seller dashboard</p>
        <h1>賣家管理</h1>
        {!isActiveAccount && <AccountAccessNotice state={accountAccessState} />}
        {isDataLoading ? (
          <p role="status">賣家資料載入中</p>
        ) : (
          <>
            <div className="dashboard-summary">
              <p>販售中：{summary.activeCount}</p>
              <p>停權保留：{summary.heldCount}</p>
              <p>已售張數：{summary.soldQuantity}</p>
              <p>成交金額：NT${summary.revenue.toLocaleString('zh-TW')}</p>
            </div>
            {error && <p className="field-error" role="alert">{error}</p>}
            <section className="dashboard-section">
              <h2>販售中</h2>
              {listings.filter((listing) => listing.status === 'active').map((listing) => (
                <article className="listing-card" key={listing.id}>
                  <img
                    className="card-photo"
                    src={listing.imageUrls[0]}
                    alt={`${listing.cardName ?? listing.characterName ?? '卡片'} 實卡照片`}
                  />
                  <div className="listing-details">
                    <ListingMetadata listing={listing} cards={cards} compact />
                    <p>NT${listing.listingPrice} / 剩餘 {listing.remainingQuantity}</p>
                    {isActiveAccount && (
                      <>
                        <a href={`#/listing/${listing.id}/edit`}>編輯</a>
                        <button
                          type="button"
                          onClick={() => {
                            setSelected(listing);
                            setQuantity('1');
                            setPrice(String(listing.listingPrice));
                            salePending.current = false;
                            setIsSalePending(false);
                          }}
                        >
                          登記成交
                        </button>
                      </>
                    )}
                  </div>
                </article>
              ))}
            </section>
            <section className="dashboard-section" aria-labelledby="dashboard-held-heading">
              <h2 id="dashboard-held-heading">因停權隱藏</h2>
              {listings.filter((listing) => listing.status === 'suspended').length === 0 ? (
                <p>目前沒有因停權隱藏的商品。</p>
              ) : listings.filter((listing) => listing.status === 'suspended').map((listing) => (
                <article className="listing-card listing-card--held" key={listing.id}>
                  <img
                    className="card-photo"
                    src={listing.imageUrls[0]}
                    alt={`${listing.cardName ?? listing.characterName ?? '卡片'} 實卡照片`}
                  />
                  <div className="listing-details">
                    <ListingMetadata listing={listing} cards={cards} compact />
                    <p>NT${listing.listingPrice} / 剩餘 {listing.remainingQuantity}</p>
                    <p className="moderation-eligibility">此商品目前不會顯示在市集。</p>
                    <a href={`#/listing/${listing.id}`}>
                      {isActiveAccount ? '查看與管理' : '僅供查看'}
                    </a>
                  </div>
                </article>
              ))}
            </section>
            <section className="dashboard-section">
              <h2>已售罄</h2>
              {listings.filter((listing) => listing.status === 'sold_out').map((listing) => (
                <a
                  className="dashboard-sold-out-listing"
                  key={listing.id}
                  href={`#/listing/${listing.id}`}
                >
                  <ListingMetadata listing={listing} cards={cards} compact />
                </a>
              ))}
            </section>
            <section className="dashboard-section sales-history-section">
              <h2>完整銷售紀錄</h2>
              {salesHistory.length === 0 ? (
                <p>目前沒有成交紀錄。</p>
              ) : (
                <div className="sales-history-list">
                  {salesHistory.map((sale) => {
                    const metadata = resolveSaleHistoryMetadata(sale, listings, cards);
                    return (
                      <article
                        className="sales-history-item"
                        data-testid="sale-history-item"
                        data-sale-id={sale.id}
                        key={sale.id}
                      >
                        <div>
                          <p className="sales-history-date">{formatTaipeiSaleDate(sale.soldAt)}</p>
                          <h3>{metadata.cardName}</h3>
                          <p>
                            {metadata.cardType ? cardTypeLabel(metadata.cardType) : '卡片類型不明'}
                            {' · '}{metadata.rarity} · ID {metadata.cardId}
                          </p>
                          {metadata.listingExists && (
                            <a href={`#/listing/${sale.listingId}`}>查看商品</a>
                          )}
                        </div>
                        <dl className="sales-history-values">
                          <div><dt>數量</dt><dd>{sale.quantity}</dd></div>
                          <div><dt>刊登單價</dt><dd>NT${sale.listingUnitPrice.toLocaleString('zh-TW')}</dd></div>
                          <div><dt>成交單價</dt><dd>NT${sale.soldUnitPrice.toLocaleString('zh-TW')}</dd></div>
                          <div><dt>小計</dt><dd>NT${saleLineTotal(sale).toLocaleString('zh-TW')}</dd></div>
                        </dl>
                        <span className="sales-history-readable-values">
                          數量：{sale.quantity} / 刊登單價：NT${sale.listingUnitPrice.toLocaleString('zh-TW')}
                          {' / '}成交單價：NT${sale.soldUnitPrice.toLocaleString('zh-TW')}
                          {' / '}小計：NT${saleLineTotal(sale).toLocaleString('zh-TW')}
                        </span>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
        {isActiveAccount && selected && (
          <div className="modal" role="dialog" aria-modal="true" aria-label="登記成交">
            <h2>登記成交</h2>
            <label>
              數量
              <input value={quantity} onChange={(event) => setQuantity(event.target.value)} />
            </label>
            <label>
              實際單價
              <input value={price} onChange={(event) => setPrice(event.target.value)} />
            </label>
            <button type="button" onClick={submitSale} disabled={isSalePending}>
              {isSalePending ? '成交登記中' : '確認成交'}
            </button>
            <button type="button" onClick={() => setSelected(null)} disabled={isSalePending}>取消</button>
          </div>
        )}
      </section>
    </PageShell>
  );
}
