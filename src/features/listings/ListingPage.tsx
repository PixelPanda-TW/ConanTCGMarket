import { useEffect, useState } from 'react';
import type { Card, Listing } from '../../domain/models';
import { getListing, getPublicSellerProfile, listCards } from '../../data/firestore/repositories';
import { useAuth } from '../auth/AuthProvider';
import { BackToMarketplaceLink } from '../../components/BackToMarketplaceLink';

export function ListingPage({ id }: { id: string }) {
  const { user } = useAuth(); const [listing, setListing] = useState<Listing | null>(); const [card, setCard] = useState<Card | null>(); const [seller, setSeller] = useState<{ displayName: string; contactType: string; contactValue: string } | null>();
  useEffect(() => { void getListing(id).then(async (value) => { setListing(value); if (!value) return; const [cards, profile] = await Promise.all([listCards(), getPublicSellerProfile(value.sellerId)]); setCard(cards.find((item) => item.id === value.cardId) ?? null); setSeller(profile); }).catch(() => setListing(null)); }, [id]);
  if (listing === undefined) return <main className="app-shell"><BackToMarketplaceLink /><p>商品載入中</p></main>;
  if (!listing || listing.status !== 'active') return <main className="app-shell"><BackToMarketplaceLink /><section className="listing-state"><h1>找不到商品</h1></section></main>;
  const name = listing.characterName ?? card?.characterName ?? card?.nameZh ?? card?.nameJa ?? '未提供角色／人名';
  const rarity = listing.rarity ?? card?.rarity ?? '未提供稀有度';
  return <main className="app-shell"><BackToMarketplaceLink /><article className="listing-page">
    <header className="listing-page-header"><p className="eyebrow">{rarity}</p><h1>{name}</h1><p>商品詳情與聯絡資訊</p></header>
    <div className="listing-page-layout">
      <div className="listing-images">{listing.imageUrls.map((url) => <img key={url} src={url} alt={`${name} 實卡照片`} />)}</div>
      <aside className="listing-purchase-panel"><p className="listing-price">NT${listing.listingPrice.toLocaleString('zh-TW')}<span>／張</span></p><p className="listing-stock">剩餘 {listing.remainingQuantity} 張</p><div className="listing-tags">{listing.hasSleeve && <span>包手{listing.sleeveFee !== undefined ? `（包材費 NT$${listing.sleeveFee}）` : ''}</span>}{listing.supportsMyShip && <span>支援賣貨便{listing.myShipFee !== undefined ? `（加價 NT$${listing.myShipFee}）` : ''}</span>}</div><hr /><p className="seller-label">賣家</p><p className="seller-name">{seller?.displayName ?? '賣家'}</p>{seller ? <a className="contact-link" href={seller.contactType === 'line' ? `https://line.me/ti/p/~${seller.contactValue}` : undefined} target="_blank" rel="noreferrer">以 {seller.contactType} 聯絡：{seller.contactValue}</a> : <p>聯絡方式載入中</p>}{listing.note && <p className="listing-note">{listing.note}</p>}{user?.uid === listing.sellerId && <a className="edit-listing-link" href={`#/listing/${id}/edit`}>管理此商品</a>}</aside>
    </div>
  </article></main>;
}
