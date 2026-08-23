import { useEffect, useState } from 'react';
import type { Card, Listing } from '../../domain/models';
import { getListing, getPublicSellerProfile, listCards } from '../../data/firestore/repositories';
import { useAuth } from '../auth/AuthProvider';

export function ListingPage({ id }: { id: string }) {
  const { user } = useAuth(); const [listing, setListing] = useState<Listing | null>(); const [card, setCard] = useState<Card | null>(); const [seller, setSeller] = useState<{ displayName: string; contactType: string; contactValue: string } | null>();
  useEffect(() => { void getListing(id).then(async (value) => { setListing(value); if (!value) return; const [cards, profile] = await Promise.all([listCards(), getPublicSellerProfile(value.sellerId)]); setCard(cards.find((item) => item.id === value.cardId) ?? null); setSeller(profile); }).catch(() => setListing(null)); }, [id]);
  if (listing === undefined) return <main className="app-shell"><p>商品載入中</p></main>;
  if (!listing || listing.status !== 'active') return <main className="app-shell"><h1>找不到商品</h1><a href="#/">返回市集</a></main>;
  return <main className="app-shell"><section className="profile-page"><a href="#/">返回市集</a><h1>{card?.nameZh ?? card?.nameJa ?? listing.cardId}</h1><p>{card?.rarity}</p><div className="listing-images">{listing.imageUrls.map((url) => <img key={url} src={url} alt="實卡照片" />)}</div><p className="price">NT${listing.listingPrice.toLocaleString('zh-TW')} / 張</p><p>剩餘 {listing.remainingQuantity} 張</p><p>賣家：{seller?.displayName ?? '賣家'}</p>{seller && <p>聯絡方式：{seller.contactType} · {seller.contactValue}</p>}<p>{listing.hasSleeve && '包手 '}{listing.supportsMyShip && '賣貨便'}</p>{listing.note && <p>備註：{listing.note}</p>}{user?.uid === listing.sellerId && <a href={`#/listing/${id}/edit`}>編輯商品</a>}</section></main>;
}
