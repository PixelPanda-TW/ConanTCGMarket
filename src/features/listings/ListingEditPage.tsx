import { useEffect, useState, type FormEvent } from 'react';
import type { Listing } from '../../domain/models';
import { getListing, updateListing } from '../../data/firestore/repositories';
import { useAuth } from '../auth/AuthProvider';

export function ListingEditPage({ id }: { id: string }) {
  const { user } = useAuth(); const [listing, setListing] = useState<Listing | null>(); const [error, setError] = useState<string | null>(null); const [saved, setSaved] = useState(false);
  useEffect(() => { void getListing(id).then(setListing).catch(() => setListing(null)); }, [id]);
  if (listing === undefined) return <main className="app-shell"><p>載入中</p></main>;
  if (!listing || user?.uid !== listing.sellerId) return <main className="app-shell"><h1>無法編輯商品</h1><a href={`#/listing/${id}`}>返回商品</a></main>;
  const editable = listing;
  function change(patch: Partial<Listing>) { setListing({ ...editable, ...patch, updatedAt: new Date() }); }
  async function submit(event: FormEvent) { event.preventDefault(); const sold = editable.originalQuantity - editable.remainingQuantity; if (editable.remainingQuantity < sold || editable.remainingQuantity > editable.originalQuantity || editable.listingPrice <= 0) { setError('價格或庫存不正確。'); return; } try { await updateListing({ ...editable, status: editable.remainingQuantity === 0 ? 'sold_out' : 'active' }); setSaved(true); setError(null); } catch (caught) { setError(caught instanceof Error ? caught.message : '無法更新商品。'); } }
  return <main className="app-shell"><section className="profile-page"><a href={`#/listing/${id}`}>返回商品</a><h1>編輯商品</h1><form className="profile-form" onSubmit={submit}><label>價格<input value={editable.listingPrice} onChange={(e) => change({ listingPrice: Number(e.target.value) })} /></label><label>剩餘數量<input value={editable.remainingQuantity} onChange={(e) => change({ remainingQuantity: Number(e.target.value) })} /></label><label><input type="checkbox" checked={editable.hasSleeve} onChange={(e) => change({ hasSleeve: e.target.checked })} />包手</label><label><input type="checkbox" checked={editable.supportsMyShip} onChange={(e) => change({ supportsMyShip: e.target.checked })} />賣貨便</label><label>備註<textarea value={editable.note ?? ''} onChange={(e) => change({ note: e.target.value || undefined })} /></label><button>儲存變更</button>{error && <p role="alert">{error}</p>}{saved && <p role="status">已更新商品</p>}</form></section></main>;
}
