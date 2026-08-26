import { useEffect, useState } from 'react';
import type { Card, Listing, Sale } from '../../domain/models';
import { listCards, listSellerListings, listSellerSales, recordSale } from '../../data/firestore/repositories';
import { useAuth } from '../auth/AuthProvider';
import { PageShell } from '../../components/PageShell';
import { summarizeDashboard } from './dashboardSummary';
import { ListingMetadata } from '../listings/ListingMetadata';

export function DashboardPage() {
  const { user, isLoading } = useAuth(); const [cards, setCards] = useState<Card[]>([]); const [listings, setListings] = useState<Listing[]>([]); const [sales, setSales] = useState<Sale[]>([]); const [selected, setSelected] = useState<Listing | null>(null); const [quantity, setQuantity] = useState('1'); const [price, setPrice] = useState(''); const [error, setError] = useState<string | null>(null);
  const load = () => { if (user) { void Promise.all([listSellerListings(user.uid), listSellerSales(user.uid)]).then(([nextListings, nextSales]) => { setListings(nextListings); setSales(nextSales); }).catch(() => setError('無法載入賣家資料。')); void listCards().then(setCards).catch(() => setCards([])); } };
  useEffect(load, [user]);
  if (isLoading) return <PageShell backToMarketplace><p>載入中</p></PageShell>;
  if (!user) return <PageShell backToMarketplace><h1>賣家管理</h1><p>請先登入才能管理商品。</p></PageShell>;
  const summary = summarizeDashboard(listings, sales);
  async function submitSale() { if (!selected) return; const count = Number(quantity); const unit = Number(price); if (!Number.isInteger(count) || count < 1 || count > selected.remainingQuantity || !Number.isFinite(unit) || unit <= 0) { setError('成交數量或價格不正確。'); return; } try { await recordSale(selected.id, count, unit); setSelected(null); setError(null); load(); } catch (caught) { setError(caught instanceof Error ? caught.message : '無法登記成交。'); } }
  return <PageShell backToMarketplace><section className="profile-page dashboard-page"><p className="eyebrow">Seller dashboard</p><h1>賣家管理</h1><div className="dashboard-summary"><p>販售中：{summary.activeCount}</p><p>已售張數：{summary.soldQuantity}</p><p>成交金額：NT${summary.revenue.toLocaleString('zh-TW')}</p></div>{error && <p className="field-error" role="alert">{error}</p>}<section className="dashboard-section"><h2>販售中</h2>{listings.filter((listing) => listing.status === 'active').map((listing) => <article className="listing-card" key={listing.id}><img className="card-photo" src={listing.imageUrls[0]} alt={`${listing.cardName ?? listing.characterName ?? '卡片'} 實卡照片`} /><div className="listing-details"><ListingMetadata listing={listing} card={cards.find((card) => card.id === listing.cardId) ?? null} compact /><p>NT${listing.listingPrice} / 剩餘 {listing.remainingQuantity}</p><a href={`#/listing/${listing.id}/edit`}>編輯</a><button type="button" onClick={() => { setSelected(listing); setQuantity('1'); setPrice(String(listing.listingPrice)); }}>登記成交</button></div></article>)}</section><section className="dashboard-section"><h2>已售罄</h2>{listings.filter((listing) => listing.status === 'sold_out').map((listing) => <a className="dashboard-sold-out-listing" key={listing.id} href={`#/listing/${listing.id}`}><ListingMetadata listing={listing} card={cards.find((card) => card.id === listing.cardId) ?? null} compact /></a>)}</section>
  {selected && <div className="modal" role="dialog" aria-modal="true" aria-label="登記成交"><h2>登記成交</h2><label>數量<input value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label><label>實際單價<input value={price} onChange={(event) => setPrice(event.target.value)} /></label><button type="button" onClick={submitSale}>確認成交</button><button type="button" onClick={() => setSelected(null)}>取消</button></div>}</section></PageShell>;
}
