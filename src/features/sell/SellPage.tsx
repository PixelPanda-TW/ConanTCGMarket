import { useEffect, useState, type FormEvent } from 'react';
import type { Listing, SellerProfile } from '../../domain/models';
import { developmentCards } from '../../data/cards/developmentCards';
import { createListing, createListingId, getSellerProfile } from '../../data/firestore/repositories';
import { uploadListingImages } from '../../data/storage/storageService';
import { useAuth } from '../auth/AuthProvider';
import { CardSelector } from '../cards/CardSelector';
import { validateSellForm, type SellFormState } from './sellForm';

const initial: SellFormState = { card: null, files: [], listingPrice: '', quantity: '', hasSleeve: false, supportsMyShip: false, note: '' };
export function SellPage({ loadSellerProfile = getSellerProfile }: { loadSellerProfile?: (uid: string) => Promise<SellerProfile | null> }) {
  const { user, isLoading } = useAuth();
  const [profile, setProfile] = useState<SellerProfile | null | undefined>();
  const [form, setForm] = useState(initial); const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null); const [saving, setSaving] = useState(false);
  useEffect(() => { if (user) void loadSellerProfile(user.uid).then(setProfile).catch(() => setProfile(null)); }, [loadSellerProfile, user]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setMessage(null); const result = validateSellForm(form); setForm(result.values); setErrors(result.errors);
    if (Object.keys(result.errors).length || !user) return;
    setSaving(true); try { const id = createListingId(); const urls = await uploadListingImages(user.uid, id, result.values.files); const now = new Date(); const quantity = Number(result.values.quantity);
      await createListing({ id, sellerId: user.uid, cardId: result.values.card!.id, imageUrls: urls, listingPrice: Number(result.values.listingPrice), originalQuantity: quantity, remainingQuantity: quantity, hasSleeve: result.values.hasSleeve, supportsMyShip: result.values.supportsMyShip, note: result.values.note || undefined, status: 'active', createdAt: now, updatedAt: now });
      setMessage('刊登成功'); window.location.hash = `#/listing/${id}`;
    } catch (error) { setMessage(error instanceof Error ? error.message : '刊登失敗，請稍後再試。'); } finally { setSaving(false); }
  }
  if (isLoading || profile === undefined) return <main className="app-shell"><p>載入中</p></main>;
  if (!user) return <main className="app-shell"><h1>刊登商品</h1><p>請先使用 Google 登入，才能刊登商品。</p></main>;
  if (!profile) return <main className="app-shell"><h1>刊登商品</h1><p>請先完成賣家個人檔案，才能刊登商品。</p><a href="#/profile">前往設定個人檔案</a></main>;
  return <main className="app-shell"><section className="profile-page"><a href="#/">返回市集</a><h1>刊登商品</h1><p>同版本、相近卡況才合併刊登。</p><form className="profile-form" onSubmit={submit} noValidate>
    <CardSelector cards={developmentCards} value={form.card} onChange={(card) => setForm({ ...form, card })} />{errors.card && <p role="alert">{errors.card}</p>}
    <label>商品圖片<input aria-label="商品圖片" type="file" accept="image/*" multiple onChange={(e) => setForm({ ...form, files: Array.from(e.target.files ?? []) })} /></label>{errors.files && <p role="alert">{errors.files}</p>}
    <label>價格<input aria-label="價格" inputMode="numeric" value={form.listingPrice} onChange={(e) => setForm({ ...form, listingPrice: e.target.value })} /></label>{errors.listingPrice && <p role="alert">{errors.listingPrice}</p>}
    <label>數量<input aria-label="數量" inputMode="numeric" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></label>{errors.quantity && <p role="alert">{errors.quantity}</p>}
    <label><input aria-label="包手" type="checkbox" checked={form.hasSleeve} onChange={(e) => setForm({ ...form, hasSleeve: e.target.checked })} />包手</label>
    <label><input aria-label="支援賣貨便" type="checkbox" checked={form.supportsMyShip} onChange={(e) => setForm({ ...form, supportsMyShip: e.target.checked })} />賣貨便</label>
    <label>備註<textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
    <button type="submit" disabled={saving}>{saving ? '上架中' : '建立刊登'}</button>{message && <p role="status">{message}</p>}
  </form></section></main>;
}
