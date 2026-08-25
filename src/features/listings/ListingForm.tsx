import type { ReactNode } from 'react';
import { CheckboxField, FieldError, FieldLabel } from '../../components/forms/FormField';

export interface ListingFormErrors {
  files?: string;
  listingPrice?: string;
  quantity?: string;
  sleeveFee?: string;
  myShipFee?: string;
}

interface ListingFormProps {
  price: string | number;
  quantity: string | number;
  files: File[];
  hasSleeve: boolean;
  sleeveFee: string | number;
  supportsMyShip: boolean;
  myShipFee: string | number;
  note: string;
  onPriceChange: (value: string) => void;
  onQuantityChange: (value: string) => void;
  onFilesChange: (files: File[]) => void;
  onHasSleeveChange: (checked: boolean) => void;
  onSleeveFeeChange: (value: string) => void;
  onSupportsMyShipChange: (checked: boolean) => void;
  onMyShipFeeChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  errors?: ListingFormErrors;
  quantityLabel?: string;
  existingImageUrls?: readonly string[];
  imageLabel?: string;
  imageRequired?: boolean;
  submitLabel: string;
  submitDisabled?: boolean;
  secondaryAction?: ReactNode;
}

export function ListingForm({
  price,
  quantity,
  files,
  hasSleeve,
  sleeveFee,
  supportsMyShip,
  myShipFee,
  note,
  onPriceChange,
  onQuantityChange,
  onFilesChange,
  onHasSleeveChange,
  onSleeveFeeChange,
  onSupportsMyShipChange,
  onMyShipFeeChange,
  onNoteChange,
  errors = {},
  quantityLabel = '數量',
  existingImageUrls,
  imageLabel = '商品圖片',
  imageRequired = true,
  submitLabel,
  submitDisabled = false,
  secondaryAction,
}: ListingFormProps) {
  const imageInputLabel = imageRequired ? imageLabel : `${imageLabel}（1–3 張）`;

  return (
    <>
      {existingImageUrls && (
        <div className="listing-images" aria-label="目前商品圖片">
          {existingImageUrls.map((url) => <img key={url} src={url} alt="目前商品圖片" />)}
        </div>
      )}
      <label>
        <FieldLabel required={imageRequired}>{imageInputLabel}</FieldLabel>
        <input
          aria-label={imageLabel}
          aria-invalid={Boolean(errors.files)}
          type="file"
          accept="image/*"
          multiple
          onChange={(event) => onFilesChange(Array.from(event.target.files ?? []))}
          required={imageRequired}
        />
      </label>
      <FieldError message={errors.files} />
      {files.length > 0 && !imageRequired && <p>已選擇 {files.length} 張新圖片。</p>}

      <div className="listing-price-fields">
        <div>
          <label>
            <FieldLabel required>價格</FieldLabel>
            <input aria-label="價格" aria-invalid={Boolean(errors.listingPrice)} inputMode="numeric" value={price} onChange={(event) => onPriceChange(event.target.value)} required />
          </label>
          <FieldError message={errors.listingPrice} />
        </div>
        <div>
          <label>
            <FieldLabel required>{quantityLabel}</FieldLabel>
            <input aria-label={quantityLabel} aria-invalid={Boolean(errors.quantity)} inputMode="numeric" value={quantity} onChange={(event) => onQuantityChange(event.target.value)} required />
          </label>
          <FieldError message={errors.quantity} />
        </div>
      </div>

      <div className="listing-service-row">
        <CheckboxField label="包手" ariaLabel="包手" checked={hasSleeve} onChange={(event) => onHasSleeveChange(event.target.checked)} />
        {hasSleeve && (
          <label className="service-fee">
            <FieldLabel required>包材費</FieldLabel>
            <input aria-label="包材費" aria-invalid={Boolean(errors.sleeveFee)} inputMode="numeric" min="0" value={sleeveFee} onChange={(event) => onSleeveFeeChange(event.target.value)} placeholder="可填 0" required />
          </label>
        )}
        <FieldError message={errors.sleeveFee} />
      </div>
      <div className="listing-service-row">
        <CheckboxField label="賣貨便" ariaLabel="支援賣貨便" checked={supportsMyShip} onChange={(event) => onSupportsMyShipChange(event.target.checked)} />
        {supportsMyShip && (
          <label className="service-fee">
            <FieldLabel required>賣貨便加價</FieldLabel>
            <input aria-label="賣貨便加價" aria-invalid={Boolean(errors.myShipFee)} inputMode="numeric" min="0" value={myShipFee} onChange={(event) => onMyShipFeeChange(event.target.value)} placeholder="可填 0" required />
          </label>
        )}
        <FieldError message={errors.myShipFee} />
      </div>
      <aside className="listing-requirements" aria-label="其他交易需求提醒">若有其他交易需求，請在備註中說明，例如：有賣貨便連結放備註，可自己下單並通知回報、賣場未滿指定金額不出貨、可接受 &lt; ... &gt; 角色換物</aside>
      <label>
        <FieldLabel>備註（選填）</FieldLabel>
        <textarea aria-label="備註" value={note} onChange={(event) => onNoteChange(event.target.value)} />
      </label>
      <div className="listing-form-actions">
        <button type="submit" disabled={submitDisabled}>{submitLabel}</button>
        {secondaryAction}
      </div>
    </>
  );
}
