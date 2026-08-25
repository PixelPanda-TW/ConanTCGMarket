import { useEffect, useState, type FormEvent } from 'react';
import type { Card, SellerProfile } from '../../domain/models';
import { createListing, createListingId, getSellerProfile, listCards } from '../../data/firestore/repositories';
import { uploadListingImages } from '../../data/storage/storageService';
import { useAuth } from '../auth/AuthProvider';
import { BackToMarketplaceLink } from '../../components/BackToMarketplaceLink';
import {
  getCardIdsForMetadata,
  getCharacterNameSuggestions,
  getRaritiesForCharacter,
  hasKnownCardMetadata,
  validateSellForm,
  type SellFormErrors,
  type SellFormState,
} from './sellForm';

const initial: SellFormState = { cardId: '', characterName: '', rarity: '', files: [], listingPrice: '', quantity: '', hasSleeve: false, supportsMyShip: false, note: '' };
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

  const characterSuggestions = cards ? getCharacterNameSuggestions(cards, form.characterName) : [];
  const rarityOptions = cards ? getRaritiesForCharacter(cards, form.characterName) : [];
  const cardIdOptions = cards ? getCardIdsForMetadata(cards, form.characterName, form.rarity) : [];

  function updateCharacterName(characterName: string) {
    setForm((current) => ({ ...current, characterName, rarity: '', cardId: '' }));
    setErrors((current) => ({ ...current, characterName: undefined, rarity: undefined, cardId: undefined }));
  }

  function updateRarity(rarity: string) {
    setForm((current) => ({ ...current, rarity, cardId: '' }));
    setErrors((current) => ({ ...current, rarity: undefined, cardId: undefined }));
  }
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
      await createListing({ id, sellerId: user.uid, cardId: result.values.cardId, characterName: result.values.characterName, rarity: result.values.rarity, imageUrls: urls, listingPrice: Number(result.values.listingPrice), originalQuantity: quantity, remainingQuantity: quantity, hasSleeve: result.values.hasSleeve, supportsMyShip: result.values.supportsMyShip, note: result.values.note || undefined, status: 'active', createdAt: now, updatedAt: now });
      setMessage('刊登成功'); window.location.hash = `#/listing/${id}`;
    } catch (error) { setMessage(error instanceof Error ? error.message : '刊登失敗，請稍後再試。'); } finally { setSaving(false); }
  }
  if (isLoading || profile === undefined) return <main className="app-shell"><p>載入中</p></main>;
  if (!user) return <main className="app-shell"><h1>刊登商品</h1><p>請先使用 Google 登入，才能刊登商品。</p></main>;
  if (!profile) return <main className="app-shell"><h1>刊登商品</h1><p>請先完成賣家個人檔案，才能刊登商品。</p><a href="#/profile">前往設定個人檔案</a></main>;
  return <main className="app-shell"><BackToMarketplaceLink /><section className="profile-page"><h1>刊登商品</h1><p>同版本、相近卡況才合併刊登。</p><form className="profile-form listing-form" onSubmit={submit} noValidate>
    <label>角色／人名<input aria-label="角色／人名" aria-invalid={Boolean(errors.characterName)} value={form.characterName} onChange={(e) => updateCharacterName(e.target.value)} list="character-name-options" autoComplete="off" placeholder="輸入角色／人名前幾個字" /></label>
    <datalist id="character-name-options">{characterSuggestions.map((name) => <option key={name} value={name} />)}</datalist>
    {errors.characterName && <p className="field-error" role="alert">{errors.characterName}</p>}
    <label>稀有度<input aria-label="稀有度" aria-invalid={Boolean(errors.rarity)} value={form.rarity} onChange={(e) => updateRarity(e.target.value)} list="rarity-options" autoComplete="off" disabled={!form.characterName || Boolean(cardLoadError)} /></label>
    <datalist id="rarity-options">{rarityOptions.map((rarity) => <option key={rarity} value={rarity} />)}</datalist>
    {errors.rarity && <p className="field-error" role="alert">{errors.rarity}</p>}
    <label>卡片 ID<input aria-label="卡片 ID" aria-invalid={Boolean(errors.cardId)} inputMode="numeric" maxLength={4} value={form.cardId} onChange={(e) => setForm({ ...form, cardId: e.target.value })} list="card-id-options" autoComplete="off" placeholder="選擇稀有度後顯示 ID" disabled={!form.rarity || Boolean(cardLoadError)} /></label>
    <datalist id="card-id-options">{cardIdOptions.map((cardId) => <option key={cardId} value={cardId} />)}</datalist>
    {cardLoadError && <p className="field-error" role="alert">{cardLoadError}</p>}
    {errors.cardId && <p className="field-error" role="alert">{errors.cardId}</p>}
    <label>商品圖片<input aria-label="商品圖片" aria-invalid={Boolean(errors.files)} type="file" accept="image/*" multiple onChange={(e) => setForm({ ...form, files: Array.from(e.target.files ?? []) })} /></label>{errors.files && <p className="field-error" role="alert">{errors.files}</p>}
    <label>價格<input aria-label="價格" inputMode="numeric" value={form.listingPrice} onChange={(e) => setForm({ ...form, listingPrice: e.target.value })} /></label>{errors.listingPrice && <p role="alert">{errors.listingPrice}</p>}
    <label>數量<input aria-label="數量" inputMode="numeric" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></label>{errors.quantity && <p role="alert">{errors.quantity}</p>}
    <label className="checkbox-field"><input aria-label="包手" type="checkbox" checked={form.hasSleeve} onChange={(e) => setForm({ ...form, hasSleeve: e.target.checked })} />包手</label>
    <label className="checkbox-field"><input aria-label="支援賣貨便" type="checkbox" checked={form.supportsMyShip} onChange={(e) => setForm({ ...form, supportsMyShip: e.target.checked })} />賣貨便</label>
    <label>備註<textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
    <button type="submit" disabled={saving}>{saving ? '上架中' : '建立刊登'}</button>{message && <p role="status">{message}</p>}
  </form></section></main>;
}
