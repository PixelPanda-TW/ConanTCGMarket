import { useEffect, useState, type FormEvent } from 'react';
import type { Listing } from '../../domain/models';
import { deleteListing, getListing, updateListing } from '../../data/firestore/repositories';
import { deleteListingImages, uploadListingImages } from '../../data/storage/storageService';
import { useAuth } from '../auth/AuthProvider';
import { deleteListingAndImages } from './listingDeletion';

export function ListingEditPage({ id }: { id: string }) {
  const { user } = useAuth(); const [listing, setListing] = useState<Listing | null>(); const [files, setFiles] = useState<File[]>([]); const [error, setError] = useState<string | null>(null); const [saved, setSaved] = useState(false);
  useEffect(() => { void getListing(id).then(setListing).catch(() => setListing(null)); }, [id]);
  if (listing === undefined) return <main className="app-shell"><p>載入中</p></main>;
  if (!listing || user?.uid !== listing.sellerId) return <main className="app-shell"><h1>無法編輯商品</h1><a href={`#/listing/${id}`}>返回商品</a></main>;
  const sellerId = user.uid;
  const editable = listing;
  function change(patch: Partial<Listing>) { setListing({ ...editable, ...patch, updatedAt: new Date() }); }
  async function submit(event: FormEvent) { event.preventDefault(); const sold = editable.originalQuantity - editable.remainingQuantity; if (editable.remainingQuantity < sold || editable.remainingQuantity > editable.originalQuantity || editable.listingPrice <= 0 || (files.length && (files.length > 3 || files.some((file) => !file.type.startsWith('image/'))))) { setError('價格、庫存或圖片不正確。'); return; } try { const imageUrls = files.length ? await uploadListingImages(sellerId, editable.id, files) : editable.imageUrls; await updateListing({ ...editable, imageUrls, status: editable.remainingQuantity === 0 ? 'sold_out' : 'active' }); if (files.length) void deleteListingImages(sellerId, editable.imageUrls).catch(() => undefined); setSaved(true); setError(null); } catch (caught) { setError(caught instanceof Error ? caught.message : '無法更新商品。'); } }
  async function remove() { if (!window.confirm('確定要刪除這筆商品嗎？此操作無法復原。')) return; try { await deleteListingAndImages(editable, deleteListing, deleteListingImages); window.location.hash = '#/dashboard'; } catch (caught) { setError(caught instanceof Error ? caught.message : '無法刪除商品。'); } }
  return <main className="app-shell"><section className="profile-page"><a href={`#/listing/${id}`}>返回商品</a><h1>編輯商品</h1><form className="profile-form" onSubmit={submit}><label>價格<input value={editable.listingPrice} onChange={(e) => change({ listingPrice: Number(e.target.value) })} /></label><label>剩餘數量<input value={editable.remainingQuantity} onChange={(e) => change({ remainingQuantity: Number(e.target.value) })} /></label><div className="listing-images" aria-label="目前商品圖片">{editable.imageUrls.map((url) => <img key={url} src={url} alt="目前商品圖片" />)}</div><label>替換商品圖片（1–3 張）<input type="file" accept="image/*" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} /></label>{files.length > 0 && <p>已選擇 {files.length} 張新圖片。</p>}<label><input type="checkbox" checked={editable.hasSleeve} onChange={(e) => change({ hasSleeve: e.target.checked })} />包手</label><label><input type="checkbox" checked={editable.supportsMyShip} onChange={(e) => change({ supportsMyShip: e.target.checked })} />賣貨便</label><label>備註<textarea value={editable.note ?? ''} onChange={(e) => change({ note: e.target.value || undefined })} /></label><button>儲存變更</button><button className="danger-button" type="button" onClick={remove}>刪除商品</button>{error && <p role="alert">{error}</p>}{saved && <p role="status">已更新商品</p>}</form></section></main>;
}
