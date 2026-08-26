import { CARD_TYPES, cardTypeLabel, type CardType } from '../domain/cardType';
import type { Card } from '../domain/models';
import {
  getCardIdsForMetadata,
  getCardNameSuggestions,
  getRaritiesForMetadata,
  type CardMetadataValue,
} from '../domain/cardMetadata';
import { FieldLabel } from './forms/FormField';

export type CardMetadataSelection = CardMetadataValue;

interface CardMetadataSelectorProps {
  cards: readonly Card[];
  value: CardMetadataSelection;
  onChange: (value: CardMetadataSelection) => void;
  showCardId?: boolean;
  required?: boolean;
  className?: string;
}

export function CardMetadataSelector({
  cards,
  value,
  onChange,
  showCardId = true,
  required = false,
  className,
}: CardMetadataSelectorProps) {
  const nameSuggestions = getCardNameSuggestions(cards, value.cardType, value.cardName);
  const rarityOptions = getRaritiesForMetadata(cards, value.cardType, value.cardName);
  const cardIdOptions = getCardIdsForMetadata(cards, value.cardType, value.cardName, value.rarity);
  const selectorClassName = ['card-metadata-selector', className].filter(Boolean).join(' ');

  function updateCardType(cardType: CardType) {
    onChange({ cardType, cardName: '', rarity: '', cardId: '' });
  }

  function updateCardName(cardName: string) {
    onChange({ ...value, cardName, rarity: '', cardId: '' });
  }

  return (
    <div className={selectorClassName}>
      <label>
        <FieldLabel required={required}>卡片類型</FieldLabel>
        <select
          aria-label="卡片類型"
          value={value.cardType}
          onChange={(event) => updateCardType(event.target.value as CardType)}
          required={required}
        >
          {CARD_TYPES.map((cardType) => <option key={cardType} value={cardType}>{cardTypeLabel(cardType)}</option>)}
        </select>
      </label>

      <label className="card-metadata-selector__name">
        <FieldLabel required={required}>卡片名稱</FieldLabel>
        <input
          aria-label="卡片名稱"
          list="card-metadata-name-options"
          value={value.cardName}
          onChange={(event) => updateCardName(event.target.value)}
          autoComplete="off"
          placeholder="輸入卡片名稱"
          required={required}
        />
        <datalist id="card-metadata-name-options">
          {nameSuggestions.map((name) => <option key={name} value={name} />)}
        </datalist>
      </label>

      <label>
        <FieldLabel required={required}>稀有度</FieldLabel>
        <select
          aria-label="稀有度"
          value={value.rarity}
          onChange={(event) => onChange({ ...value, rarity: event.target.value, cardId: '' })}
          disabled={!value.cardName}
          required={required}
        >
          <option value="">請選擇稀有度</option>
          {rarityOptions.map((rarity) => <option key={rarity} value={rarity}>{rarity}</option>)}
        </select>
      </label>

      {showCardId && (
        <label>
          <FieldLabel required={required}>卡片 ID</FieldLabel>
          <select
            aria-label="卡片 ID"
            value={value.cardId}
            onChange={(event) => onChange({ ...value, cardId: event.target.value })}
            disabled={!value.rarity}
            required={required}
          >
            <option value="">請選擇卡片 ID</option>
            {cardIdOptions.map((cardId) => <option key={cardId} value={cardId}>{cardId}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}
