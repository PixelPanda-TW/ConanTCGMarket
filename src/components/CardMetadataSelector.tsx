import type { Card } from '../domain/models';
import {
  getCardIdsForMetadata,
  getCharacterNameSuggestions,
  getRaritiesForCharacter,
} from '../domain/cardMetadata';
import { FieldLabel } from './forms/FormField';

export interface CardMetadataSelection {
  characterName: string;
  rarity: string;
  cardId: string;
}

interface CardMetadataSelectorProps {
  cards: readonly Card[];
  value: CardMetadataSelection;
  onChange: (value: CardMetadataSelection) => void;
  requireCardId: boolean;
  required?: boolean;
  className?: string;
}

export function CardMetadataSelector({
  cards,
  value,
  onChange,
  requireCardId,
  required = false,
  className,
}: CardMetadataSelectorProps) {
  const characterSuggestions = getCharacterNameSuggestions(cards, value.characterName);
  const rarityOptions = getRaritiesForCharacter(cards, value.characterName);
  const cardIdOptions = getCardIdsForMetadata(cards, value.characterName, value.rarity);
  const selectorClassName = ['card-metadata-selector', className].filter(Boolean).join(' ');

  function updateCharacterName(characterName: string) {
    onChange({ characterName, rarity: '', cardId: '' });
  }

  return (
    <div className={selectorClassName}>
      <label className="card-metadata-selector__character">
        <FieldLabel required={required}>角色／人名</FieldLabel>
        <input
          aria-label="角色／人名"
          list="card-metadata-character-options"
          value={value.characterName}
          onChange={(event) => updateCharacterName(event.target.value)}
          autoComplete="off"
          placeholder="輸入角色／人名"
          required={required}
        />
        <datalist id="card-metadata-character-options">
          {characterSuggestions.map((name) => <option key={name} value={name} />)}
        </datalist>
      </label>

      <label>
        <FieldLabel required={required}>稀有度</FieldLabel>
        <select
          aria-label="稀有度"
          value={value.rarity}
          onChange={(event) => onChange({ ...value, rarity: event.target.value, cardId: '' })}
          disabled={!value.characterName}
          required={required}
        >
          <option value="">{requireCardId ? '請選擇稀有度' : '全部稀有度'}</option>
          {rarityOptions.map((rarity) => <option key={rarity} value={rarity}>{rarity}</option>)}
        </select>
      </label>

      <label>
        <FieldLabel required={required}>卡片 ID</FieldLabel>
        <select
          aria-label="卡片 ID"
          value={value.cardId}
          onChange={(event) => onChange({ ...value, cardId: event.target.value })}
          disabled={!value.rarity}
          required={required}
        >
          <option value="">{requireCardId ? '請選擇卡片 ID' : '全部卡片 ID'}</option>
          {cardIdOptions.map((cardId) => <option key={cardId} value={cardId}>{cardId}</option>)}
        </select>
      </label>
    </div>
  );
}
