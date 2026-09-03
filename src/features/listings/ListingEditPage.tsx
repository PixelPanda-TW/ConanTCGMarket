import { useEffect, useState, type FormEvent } from 'react';
import type { Card, Listing } from '../../domain/models';
import { deleteListing, getListing, listCards, updateListing } from '../../data/firestore/repositories';
import { deleteListingImages, uploadListingImages } from '../../data/storage/storageService';
import { useAuth } from '../auth/AuthProvider';
import { deleteListingAndImages } from './listingDeletion';
import { ListingForm } from './ListingForm';
import { PageShell } from '../../components/PageShell';
import { ListingMetadata } from './ListingMetadata';
import { AccountAccessNotice } from '../auth/AccountAccessNotice';

export function ListingEditPage({ id }: { id: string }) {
  const { accountAccessState, isActiveAccount, isLoading, user } = useAuth(); const [listing, setListing] = useState<Listing | null>(); const [cards, setCards] = useState<readonly Card[]>([]); const [files, setFiles] = useState<File[]>([]); const [error, setError] = useState<string | null>(null); const [saved, setSaved] = useState(false);
  useEffect(() => {
    let isCurrent = true;
    setListing(undefined);
    setCards([]);
    if (!user || !isActiveAccount) return () => { isCurrent = false; };
    void getListing(id).then((value) => {
      if (!isCurrent) return;
      setListing(value);
      if (!value) return;
      void listCards()
        .then((loadedCards) => { if (isCurrent) setCards(loadedCards); })
        .catch(() => { if (isCurrent) setCards([]); });
    }).catch(() => { if (isCurrent) setListing(null); });
    return () => { isCurrent = false; };
  }, [id, isActiveAccount, user]);
  if (isLoading) return <PageShell><p>載入中</p></PageShell>;
  if (user && !isActiveAccount) return <PageShell><section className="profile-state"><h1>無法編輯商品</h1><AccountAccessNotice state={accountAccessState} /><a href={`#/listing/${id}`}>返回商品</a></section></PageShell>;
  if (listing === undefined) return <PageShell><p>載入中</p></PageShell>;
  if (!listing || user?.uid !== listing.sellerId) return <PageShell><h1>無法編輯商品</h1><a href={`#/listing/${id}`}>返回商品</a></PageShell>;
  const sellerId = user.uid;
  const editable = listing;
  function change(patch: Partial<Listing>) { setListing({ ...editable, ...patch, updatedAt: new Date() }); }
  async function submit(event: FormEvent) { event.preventDefault(); if (!isActiveAccount) return; const sold = editable.originalQuantity - editable.remainingQuantity; if (editable.remainingQuantity < sold || editable.remainingQuantity > editable.originalQuantity || editable.listingPrice <= 0 || (files.length && (files.length > 3 || files.some((file) => !file.type.startsWith('image/'))))) { setError('價格、庫存或圖片不正確。'); return; } try { const imageUrls = files.length ? await uploadListingImages(sellerId, editable.id, files) : editable.imageUrls; await updateListing({ ...editable, imageUrls, status: editable.remainingQuantity === 0 ? 'sold_out' : 'active' }); if (files.length) void deleteListingImages(sellerId, editable.imageUrls).catch(() => undefined); setSaved(true); setError(null); } catch (caught) { setError(caught instanceof Error ? caught.message : '無法更新商品。'); } }
  async function remove() { if (!isActiveAccount || !window.confirm('確定要刪除這筆商品嗎？此操作無法復原。')) return; try { await deleteListingAndImages(editable, deleteListing, deleteListingImages); window.location.hash = '#/dashboard'; } catch (caught) { setError(caught instanceof Error ? caught.message : '無法刪除商品。'); } }
  return <PageShell><section className="profile-page"><a href={`#/listing/${id}`}>返回商品</a><h1>編輯商品</h1><ListingMetadata listing={editable} cards={cards} /><form className="profile-form listing-form" onSubmit={submit}>
    <ListingForm
      price={editable.listingPrice}
      quantity={editable.remainingQuantity}
      quantityLabel="剩餘數量"
      files={files}
      existingImageUrls={editable.imageUrls}
      imageLabel="替換商品圖片"
      imageRequired={false}
      hasSleeve={editable.hasSleeve}
      sleeveFee={editable.sleeveFee ?? 0}
      supportsMyShip={editable.supportsMyShip}
      myShipFee={editable.myShipFee ?? 0}
      note={editable.note ?? ''}
      onPriceChange={(listingPrice) => change({ listingPrice: Number(listingPrice) })}
      onQuantityChange={(remainingQuantity) => change({ remainingQuantity: Number(remainingQuantity) })}
      onFilesChange={setFiles}
      onHasSleeveChange={(hasSleeve) => change({ hasSleeve, sleeveFee: hasSleeve ? editable.sleeveFee ?? 0 : undefined })}
      onSleeveFeeChange={(sleeveFee) => change({ sleeveFee: Number(sleeveFee) })}
      onSupportsMyShipChange={(supportsMyShip) => change({ supportsMyShip, myShipFee: supportsMyShip ? editable.myShipFee ?? 0 : undefined })}
      onMyShipFeeChange={(myShipFee) => change({ myShipFee: Number(myShipFee) })}
      onNoteChange={(note) => change({ note: note || undefined })}
      submitLabel="儲存變更"
      secondaryAction={<button className="danger-button" type="button" onClick={remove}>刪除商品</button>}
    />
    {error && <p role="alert">{error}</p>}{saved && <p role="status">已更新商品</p>}
  </form></section></PageShell>;
}
