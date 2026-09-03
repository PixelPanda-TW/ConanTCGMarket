import { useEffect, useState, type FormEvent } from 'react';
import type { Card, SellerProfile } from '../../domain/models';
import { createListing, createListingId, getSellerProfile, listCards } from '../../data/firestore/repositories';
import { uploadListingImages } from '../../data/storage/storageService';
import { useAuth } from '../auth/AuthProvider';
import { AccountAccessNotice } from '../auth/AccountAccessNotice';
import { PageShell } from '../../components/PageShell';
import { CardMetadataSelector } from '../../components/CardMetadataSelector';
import { ListingForm } from '../listings/ListingForm';
import {
  hasKnownCardMetadata,
  validateSellForm,
  type SellFormErrors,
  type SellFormState,
} from './sellForm';

const initial: SellFormState = { cardId: '', cardType: 'character', cardName: '', rarity: '', files: [], listingPrice: '', quantity: '', hasSleeve: false, sleeveFee: '', supportsMyShip: false, myShipFee: '', note: '' };
export function SellPage({ loadSellerProfile = getSellerProfile }: { loadSellerProfile?: (uid: string) => Promise<SellerProfile | null> }) {
  const { accountAccessState, isActiveAccount, user, isLoading } = useAuth();
  const [profile, setProfile] = useState<SellerProfile | null | undefined>();
  const [cards, setCards] = useState<readonly Card[] | null>(null);
  const [cardLoadError, setCardLoadError] = useState<string | null>(null);
  const [form, setForm] = useState(initial); const [errors, setErrors] = useState<SellFormErrors>({});
  const [message, setMessage] = useState<string | null>(null); const [saving, setSaving] = useState(false);
  useEffect(() => {
    let isCurrent = true;
    if (!user || !isActiveAccount) {
      setProfile(undefined);
      return () => { isCurrent = false; };
    }
    void loadSellerProfile(user.uid)
      .then((value) => { if (isCurrent) setProfile(value); })
      .catch(() => { if (isCurrent) setProfile(null); });
    return () => { isCurrent = false; };
  }, [isActiveAccount, loadSellerProfile, user]);
  useEffect(() => {
    let isCurrent = true;
    if (!user || !isActiveAccount) {
      setCards(null);
      return () => { isCurrent = false; };
    }

    setCardLoadError(null);
    void listCards()
      .then((loadedCards) => { if (isCurrent) setCards(loadedCards); })
      .catch(() => { if (isCurrent) setCardLoadError('無法載入卡牌資料，請重新整理後再試。'); });

    return () => { isCurrent = false; };
  }, [isActiveAccount, user]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setMessage(null); const result = validateSellForm(form); setForm(result.values); setErrors(result.errors);
    if (Object.keys(result.errors).length || !user || !isActiveAccount) return;
    try {
      if (!cards) {
        setMessage(cardLoadError ?? '卡牌資料載入中，請稍後再試。');
        return;
      }
      if (!hasKnownCardMetadata(cards, result.values)) {
        setErrors({ cardId: '資料庫找不到這組卡片類型、卡片名稱、稀有度與 ID，請確認後再試。' });
        return;
      }
    } catch { setMessage('無法驗證卡片資料，請稍後再試。'); return; }
    setSaving(true); try { const id = createListingId(); const urls = await uploadListingImages(user.uid, id, result.values.files); const now = new Date(); const quantity = Number(result.values.quantity);
      await createListing({ id, sellerId: user.uid, cardId: result.values.cardId, cardType: result.values.cardType, cardName: result.values.cardName, ...(result.values.cardType === 'character' ? { characterName: result.values.cardName } : {}), rarity: result.values.rarity, imageUrls: urls, listingPrice: Number(result.values.listingPrice), originalQuantity: quantity, remainingQuantity: quantity, hasSleeve: result.values.hasSleeve, sleeveFee: result.values.hasSleeve ? Number(result.values.sleeveFee) : undefined, supportsMyShip: result.values.supportsMyShip, myShipFee: result.values.supportsMyShip ? Number(result.values.myShipFee) : undefined, note: result.values.note || undefined, status: 'active', createdAt: now, updatedAt: now });
      setMessage('刊登成功'); window.location.hash = `#/listing/${id}`;
    } catch (error) { setMessage(error instanceof Error ? error.message : '刊登失敗，請稍後再試。'); } finally { setSaving(false); }
  }
  if (isLoading) return <PageShell width="wide-form"><p>載入中</p></PageShell>;
  if (!user) return <PageShell width="wide-form"><h1>刊登商品</h1><p>請先使用 Google 登入，才能刊登商品。</p></PageShell>;
  if (!isActiveAccount) return <PageShell width="wide-form" backToMarketplace><section className="profile-page profile-state"><h1>刊登商品</h1><AccountAccessNotice state={accountAccessState} /></section></PageShell>;
  if (profile === undefined) return <PageShell width="wide-form"><p>載入中</p></PageShell>;
  if (!profile) return <PageShell width="wide-form"><h1>刊登商品</h1><p>請先完成賣家個人檔案，才能刊登商品。</p><a href="#/profile">前往設定個人檔案</a></PageShell>;
  return <PageShell width="wide-form" backToMarketplace><section className="profile-page sell-page"><h1>刊登商品</h1><p>同版本、相近卡況才合併刊登。</p><form className="profile-form listing-form" onSubmit={submit} noValidate>
    <CardMetadataSelector
      cards={cards ?? []}
      value={form}
      onChange={(metadata) => {
        setForm((current) => ({ ...current, ...metadata }));
        setErrors((current) => ({ ...current, cardType: undefined, cardName: undefined, rarity: undefined, cardId: undefined }));
      }}
      requireCardId
      required
      className="listing-card-fields"
    />
    {(errors.cardType || errors.cardName || errors.rarity || errors.cardId) && <p className="field-error" role="alert">{errors.cardType ?? errors.cardName ?? errors.rarity ?? errors.cardId}</p>}
    {cardLoadError && <p className="field-error" role="alert">{cardLoadError}</p>}
    <ListingForm
      price={form.listingPrice}
      quantity={form.quantity}
      files={form.files}
      hasSleeve={form.hasSleeve}
      sleeveFee={form.sleeveFee}
      supportsMyShip={form.supportsMyShip}
      myShipFee={form.myShipFee}
      note={form.note}
      errors={errors}
      onPriceChange={(listingPrice) => setForm((current) => ({ ...current, listingPrice }))}
      onQuantityChange={(quantity) => setForm((current) => ({ ...current, quantity }))}
      onFilesChange={(files) => setForm((current) => ({ ...current, files }))}
      onHasSleeveChange={(hasSleeve) => setForm((current) => ({ ...current, hasSleeve, sleeveFee: hasSleeve ? current.sleeveFee : '' }))}
      onSleeveFeeChange={(sleeveFee) => setForm((current) => ({ ...current, sleeveFee }))}
      onSupportsMyShipChange={(supportsMyShip) => setForm((current) => ({ ...current, supportsMyShip, myShipFee: supportsMyShip ? current.myShipFee : '' }))}
      onMyShipFeeChange={(myShipFee) => setForm((current) => ({ ...current, myShipFee }))}
      onNoteChange={(note) => setForm((current) => ({ ...current, note }))}
      submitLabel={saving ? '上架中' : '建立刊登'}
      submitDisabled={saving}
    />
    {message && <p role="status">{message}</p>}
  </form></section></PageShell>;
}
