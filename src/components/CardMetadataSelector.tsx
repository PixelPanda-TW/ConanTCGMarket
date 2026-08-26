import { CARD_TYPES, cardTypeLabel, type CardType } from '../domain/cardType';
import type { Card } from '../domain/models';
import {
  getCardIdsForMetadata,
  getCardNameSuggestions,
  getRaritiesForMetadata,
  type CardMetadataValue,
  type LegacyCardMetadataValue,
} from '../domain/cardMetadata';
import { FieldLabel } from './forms/FormField';

export interface CardMetadataSelection {
  cardType?: CardType;
  cardName?: string;
  characterName?: string;
  rarity: string;
  cardId: string;
}

interface CardMetadataSelectorProps {
  cards: readonly Card[];
  value: CardMetadataSelection;
  onChange: (value: CardMetadataSelection) => void;
  showCardId?: boolean;
  /** @deprecated Use showCardId={false} for the independent Marketplace ID search. */
  requireCardId?: boolean;
  required?: boolean;
  className?: string;
}

export function CardMetadataSelector({
  cards,
  value,
  onChange,
  showCardId = true,
  requireCardId,
  required = false,
  className,
}: CardMetadataSelectorProps) {
  const isLegacySelection = value.cardType === undefined && value.characterName !== undefined;
  const cardType = value.cardType ?? '';
  const cardName = value.cardName ?? value.characterName ?? '';
  const nameSuggestions = cardType ? getCardNameSuggestions(cards, cardType, cardName) : [];
  const rarityOptions = cardType ? getRaritiesForMetadata(cards, cardType, cardName) : [];
  const cardIdOptions = cardType ? getCardIdsForMetadata(cards, cardType, cardName, value.rarity) : [];
  const selectorClassName = ['card-metadata-selector', className].filter(Boolean).join(' ');

  function updateCardType(cardType: CardType | '') {
    if (!cardType) {
      onChange({ cardType: undefined, cardName: '', rarity: '', cardId: '' });
      return;
    }
    onChange({ cardType, cardName: '', rarity: '', cardId: '' });
  }

  function updateCardName(cardName: string) {
    if (isLegacySelection) {
      onChange({ characterName: cardName, rarity: '', cardId: '' });
      return;
    }

    onChange({ ...value, cardType: value.cardType, cardName, rarity: '', cardId: '' });
  }

  function updateRarity(rarity: string) {
    if (isLegacySelection) {
      onChange({ ...value, rarity, cardId: '' });
      return;
    }

    onChange({ ...value, cardType: value.cardType, cardName, rarity, cardId: '' });
  }

  function updateCardId(cardId: string) {
    onChange(isLegacySelection ? { ...value, cardId } : { ...value, cardType: value.cardType, cardName, cardId });
  }

  return (
    <div className={selectorClassName}>
      <label>
        <FieldLabel required={required}>卡片類型</FieldLabel>
        <select
          aria-label="卡片類型"
          value={cardType}
          onChange={(event) => updateCardType(event.target.value as CardType | '')}
          required={required}
        >
          <option value="">全部類型</option>
          {CARD_TYPES.map((cardType) => <option key={cardType} value={cardType}>{cardTypeLabel(cardType)}</option>)}
        </select>
      </label>

      <label className="card-metadata-selector__name">
        <FieldLabel required={required}>{isLegacySelection ? '角色／人名' : '卡片名稱'}</FieldLabel>
        <input
          aria-label={isLegacySelection ? '角色／人名' : '卡片名稱'}
          list="card-metadata-name-options"
          value={cardName}
          onChange={(event) => updateCardName(event.target.value)}
          autoComplete="off"
          placeholder={isLegacySelection ? '輸入角色／人名' : '輸入卡片名稱'}
          disabled={!cardType}
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
          onChange={(event) => updateRarity(event.target.value)}
          disabled={!cardName}
          required={required}
        >
          <option value="">{requireCardId === false ? '全部稀有度' : '請選擇稀有度'}</option>
          {rarityOptions.map((rarity) => <option key={rarity} value={rarity}>{rarity}</option>)}
        </select>
      </label>

      {showCardId && (
        <label>
          <FieldLabel required={required}>卡片 ID</FieldLabel>
          <select
            aria-label="卡片 ID"
            value={value.cardId}
            onChange={(event) => updateCardId(event.target.value)}
            disabled={!value.rarity}
            required={required}
          >
            <option value="">{requireCardId === false ? '全部卡片 ID' : '請選擇卡片 ID'}</option>
            {cardIdOptions.map((cardId) => <option key={cardId} value={cardId}>{cardId}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}
