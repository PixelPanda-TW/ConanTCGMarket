import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Card, Listing } from '../../domain/models';
import { deleteListing, getListing, listCards, updateListing } from '../../data/firestore/repositories';
import { deleteListingImages, uploadListingImages } from '../../data/storage/storageService';
import { PageShell } from '../../components/PageShell';
import { AccountAccessNotice } from '../auth/AccountAccessNotice';
import { useAuth } from '../auth/AuthProvider';
import { deleteListingAndImages, ListingImageCleanupError } from './listingDeletion';
import { ListingForm } from './ListingForm';
import { ListingMetadata } from './ListingMetadata';

function isStaleConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && 'code' in error && error.code === 'functions/aborted';
}

export function ListingEditPage({ id }: { id: string }) {
  const { accountAccessState, isActiveAccount, isLoading, user } = useAuth();
  const [listing, setListing] = useState<Listing | null>();
  const [cards, setCards] = useState<readonly Card[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [cleanupFailedAfterDeletion, setCleanupFailedAfterDeletion] = useState(false);
  const requestKey = `${user?.uid ?? ''}:${id}`;
  const currentRequestKey = useRef(requestKey);
  currentRequestKey.current = requestKey;

  useEffect(() => {
    let isCurrent = true;
    setListing(undefined);
    setCards([]);
    setFiles([]);
    setError(null);
    setSaved(false);
    setIsPending(false);
    setCleanupFailedAfterDeletion(false);
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
  if (!user) {
    return (
      <PageShell>
        <section className="profile-state">
          <h1>無法編輯商品</h1>
          <p>請先使用 Google 登入。</p>
          <a href={`#/listing/${id}`}>返回商品</a>
        </section>
      </PageShell>
    );
  }
  if (!isActiveAccount) {
    return (
      <PageShell>
        <section className="profile-state">
          <h1>無法編輯商品</h1>
          <AccountAccessNotice state={accountAccessState} />
          <a href={`#/listing/${id}`}>返回商品</a>
        </section>
      </PageShell>
    );
  }
  if (cleanupFailedAfterDeletion) {
    return (
      <PageShell>
        <section className="profile-state">
          <h1>商品已刪除</h1>
          <p role="status">商品已刪除，但圖片清理失敗，請聯絡管理員協助。</p>
          <a href="#/dashboard">返回賣家管理</a>
        </section>
      </PageShell>
    );
  }
  if (listing === undefined) return <PageShell><p>載入中</p></PageShell>;
  if (!listing || user.uid !== listing.sellerId) {
    return <PageShell><h1>無法編輯商品</h1><a href={`#/listing/${id}`}>返回商品</a></PageShell>;
  }
  if (listing.status === 'sold_out') {
    return (
      <PageShell>
        <section className="profile-page">
          <a href={`#/listing/${id}`}>返回商品</a>
          <h1>已售罄商品</h1>
          <ListingMetadata listing={listing} cards={cards} />
          <p>此商品已有完整成交紀錄，僅供查看。</p>
        </section>
      </PageShell>
    );
  }

  const sellerId = user.uid;
  const editable = listing;
  function change(patch: Partial<Listing>) {
    setListing({ ...editable, ...patch });
    setSaved(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!isActiveAccount || isPending) return;
    if (editable.listingPrice <= 0
      || (files.length && (files.length > 3 || files.some((file) => !file.type.startsWith('image/'))))) {
      setError('價格或圖片不正確。');
      return;
    }
    const operationKey = requestKey;
    setIsPending(true);
    setError(null);
    setSaved(false);
    try {
      const imageUrls = files.length
        ? await uploadListingImages(sellerId, editable.id, files)
        : editable.imageUrls;
      const updated = await updateListing({ ...editable, imageUrls });
      if (currentRequestKey.current !== operationKey) return;
      setListing(updated);
      setFiles([]);
      setSaved(true);
      if (files.length) void deleteListingImages(sellerId, editable.imageUrls).catch(() => undefined);
    } catch (caught) {
      if (currentRequestKey.current !== operationKey) return;
      setError(isStaleConflict(caught)
        ? '商品已被更新，請重新載入後再試。'
        : caught instanceof Error ? caught.message : '無法更新商品。');
    } finally {
      if (currentRequestKey.current === operationKey) setIsPending(false);
    }
  }

  async function remove() {
    if (!isActiveAccount || isPending
      || !window.confirm('確定要刪除這筆商品嗎？此操作無法復原。')) return;
    const operationKey = requestKey;
    setIsPending(true);
    setError(null);
    try {
      await deleteListingAndImages(editable, deleteListing, deleteListingImages);
      if (currentRequestKey.current === operationKey) window.location.hash = '#/dashboard';
    } catch (caught) {
      if (currentRequestKey.current !== operationKey) return;
      if (caught instanceof ListingImageCleanupError) {
        setCleanupFailedAfterDeletion(true);
        setIsPending(false);
        return;
      }
      setError(caught instanceof Error ? caught.message : '無法刪除商品。');
      setIsPending(false);
    }
  }

  return (
    <PageShell>
      <section className="profile-page">
        <a href={`#/listing/${id}`}>返回商品</a>
        <h1>編輯商品</h1>
        <ListingMetadata listing={editable} cards={cards} />
        <form className="profile-form listing-form" onSubmit={submit}>
          <ListingForm
            price={editable.listingPrice}
            quantity={editable.remainingQuantity}
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
            onQuantityChange={() => undefined}
            onFilesChange={setFiles}
            onHasSleeveChange={(hasSleeve) => change({
              hasSleeve, sleeveFee: hasSleeve ? editable.sleeveFee ?? 0 : undefined,
            })}
            onSleeveFeeChange={(sleeveFee) => change({ sleeveFee: Number(sleeveFee) })}
            onSupportsMyShipChange={(supportsMyShip) => change({
              supportsMyShip, myShipFee: supportsMyShip ? editable.myShipFee ?? 0 : undefined,
            })}
            onMyShipFeeChange={(myShipFee) => change({ myShipFee: Number(myShipFee) })}
            onNoteChange={(note) => change({ note: note || undefined })}
            submitLabel={isPending ? '儲存中' : '儲存變更'}
            submitDisabled={isPending}
            showQuantity={false}
            secondaryAction={(
              <button className="danger-button" type="button" onClick={remove} disabled={isPending}>
                刪除商品
              </button>
            )}
          />
          {error && <p role="alert">{error}</p>}
          {saved && <p role="status">已更新商品</p>}
        </form>
      </section>
    </PageShell>
  );
}
