import { useEffect, useState, type FormEvent } from 'react';
import type { Card, SellerProfile } from '../../domain/models';
import { createListing, createListingId, getSellerProfile, listCards } from '../../data/firestore/repositories';
import { uploadListingImages } from '../../data/storage/storageService';
import { useAuth } from '../auth/AuthProvider';
import { BackToMarketplaceLink } from '../../components/BackToMarketplaceLink';
import { CardMetadataSelector } from '../../components/CardMetadataSelector';
import {
  hasKnownCardMetadata,
  validateSellForm,
  type SellFormErrors,
  type SellFormState,
} from './sellForm';

const initial: SellFormState = { cardId: '', characterName: '', rarity: '', files: [], listingPrice: '', quantity: '', hasSleeve: false, sleeveFee: '', supportsMyShip: false, myShipFee: '', note: '' };
export function SellPage({ loadSellerProfile = getSellerProfile }: { loadSellerProfile?: (uid: string) => Promise<SellerProfile | null> }) {
  const { user, isLoading } = useAuth();
  const [profile, setProfile] = useState<SellerProfile | null | undefined>();
  const [cards, setCards] = useState<readonly Card[] | null>(null);
  const [cardLoadError, setCardLoadError] = useState<string | null>(null);
  const [form, setForm] = useState(initial); const [errors, setErrors] = useState<SellFormErrors>({});
  const [message, setMessage] = useState<string | null>(null); const [saving, setSaving] = useState(false);
  useEffect(() => { if (user) void loadSellerProfile(user.uid).then(setProfile).catch(() => setProfile(null)); }, [loadSellerProfile, user]);
  useEffect(() => {
    let isCurrent = true;
    if (!user) {
      setCards(null);
      return () => { isCurrent = false; };
    }

    setCardLoadError(null);
    void listCards()
      .then((loadedCards) => { if (isCurrent) setCards(loadedCards); })
      .catch(() => { if (isCurrent) setCardLoadError('無法載入卡牌資料，請重新整理後再試。'); });

    return () => { isCurrent = false; };
  }, [user]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setMessage(null); const result = validateSellForm(form); setForm(result.values); setErrors(result.errors);
    if (Object.keys(result.errors).length || !user) return;
    try {
      if (!cards) {
        setMessage(cardLoadError ?? '卡牌資料載入中，請稍後再試。');
        return;
      }
      if (!hasKnownCardMetadata(cards, result.values)) {
        setErrors({ cardId: '資料庫找不到這組卡片 ID、角色／人名與稀有度，請確認後再試。' });
        return;
      }
    } catch { setMessage('無法驗證角色／人名，請稍後再試。'); return; }
    setSaving(true); try { const id = createListingId(); const urls = await uploadListingImages(user.uid, id, result.values.files); const now = new Date(); const quantity = Number(result.values.quantity);
      await createListing({ id, sellerId: user.uid, cardId: result.values.cardId, characterName: result.values.characterName, rarity: result.values.rarity, imageUrls: urls, listingPrice: Number(result.values.listingPrice), originalQuantity: quantity, remainingQuantity: quantity, hasSleeve: result.values.hasSleeve, sleeveFee: result.values.hasSleeve ? Number(result.values.sleeveFee) : undefined, supportsMyShip: result.values.supportsMyShip, myShipFee: result.values.supportsMyShip ? Number(result.values.myShipFee) : undefined, note: result.values.note || undefined, status: 'active', createdAt: now, updatedAt: now });
      setMessage('刊登成功'); window.location.hash = `#/listing/${id}`;
    } catch (error) { setMessage(error instanceof Error ? error.message : '刊登失敗，請稍後再試。'); } finally { setSaving(false); }
  }
  if (isLoading || profile === undefined) return <main className="app-shell"><p>載入中</p></main>;
  if (!user) return <main className="app-shell"><h1>刊登商品</h1><p>請先使用 Google 登入，才能刊登商品。</p></main>;
  if (!profile) return <main className="app-shell"><h1>刊登商品</h1><p>請先完成賣家個人檔案，才能刊登商品。</p><a href="#/profile">前往設定個人檔案</a></main>;
  return <main className="app-shell"><BackToMarketplaceLink /><section className="profile-page sell-page"><h1>刊登商品</h1><p>同版本、相近卡況才合併刊登。</p><form className="profile-form listing-form" onSubmit={submit} noValidate>
    <CardMetadataSelector
      cards={cards ?? []}
      value={form}
      onChange={(metadata) => {
        setForm((current) => ({ ...current, ...metadata }));
        setErrors((current) => ({ ...current, characterName: undefined, rarity: undefined, cardId: undefined }));
      }}
      requireCardId
      required
      className="listing-card-fields"
    />
    {(errors.characterName || errors.rarity || errors.cardId) && <p className="field-error" role="alert">{errors.characterName ?? errors.rarity ?? errors.cardId}</p>}
    {cardLoadError && <p className="field-error" role="alert">{cardLoadError}</p>}
    <label><span className="field-label"><span className="required-mark" aria-hidden="true">*</span> 商品圖片（必填）</span><input aria-label="商品圖片" aria-invalid={Boolean(errors.files)} type="file" accept="image/*" multiple onChange={(e) => setForm({ ...form, files: Array.from(e.target.files ?? []) })} required /></label>{errors.files && <p className="field-error" role="alert">{errors.files}</p>}
    <div className="listing-price-fields"><div><label><span className="field-label"><span className="required-mark" aria-hidden="true">*</span> 價格（必填）</span><input aria-label="價格" inputMode="numeric" value={form.listingPrice} onChange={(e) => setForm({ ...form, listingPrice: e.target.value })} required /></label>{errors.listingPrice && <p className="field-error" role="alert">{errors.listingPrice}</p>}</div><div><label><span className="field-label"><span className="required-mark" aria-hidden="true">*</span> 數量（必填）</span><input aria-label="數量" inputMode="numeric" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required /></label>{errors.quantity && <p className="field-error" role="alert">{errors.quantity}</p>}</div></div>
    <div className="listing-service-row"><label className="checkbox-field"><input aria-label="包手" type="checkbox" checked={form.hasSleeve} onChange={(e) => setForm({ ...form, hasSleeve: e.target.checked, sleeveFee: e.target.checked ? form.sleeveFee : '' })} />包手</label>{form.hasSleeve && <label className="service-fee"><span className="field-label"><span className="required-mark" aria-hidden="true">*</span> 包材費（必填）</span><input aria-label="包材費" inputMode="numeric" min="0" value={form.sleeveFee} onChange={(e) => setForm({ ...form, sleeveFee: e.target.value })} placeholder="可填 0" required /></label>}{errors.sleeveFee && <p className="field-error" role="alert">{errors.sleeveFee}</p>}</div>
    <div className="listing-service-row"><label className="checkbox-field"><input aria-label="支援賣貨便" type="checkbox" checked={form.supportsMyShip} onChange={(e) => setForm({ ...form, supportsMyShip: e.target.checked, myShipFee: e.target.checked ? form.myShipFee : '' })} />賣貨便</label>{form.supportsMyShip && <label className="service-fee"><span className="field-label"><span className="required-mark" aria-hidden="true">*</span> 賣貨便加價（必填）</span><input aria-label="賣貨便加價" inputMode="numeric" min="0" value={form.myShipFee} onChange={(e) => setForm({ ...form, myShipFee: e.target.value })} placeholder="可填 0" required /></label>}{errors.myShipFee && <p className="field-error" role="alert">{errors.myShipFee}</p>}</div>
    <aside className="listing-requirements" aria-label="其他交易需求提醒">若有其他交易需求，請在備註中說明，例如：有賣貨便連結下單請回報、賣場未滿指定金額不出貨。</aside>
    <label>備註（選填）<textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
    <button type="submit" disabled={saving}>{saving ? '上架中' : '建立刊登'}</button>{message && <p role="status">{message}</p>}
  </form></section></main>;
}
