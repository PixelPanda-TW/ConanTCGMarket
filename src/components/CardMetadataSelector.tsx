import { useState } from 'react';
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
  const [showCharacterSuggestions, setShowCharacterSuggestions] = useState(false);
  const characterSuggestions = getCharacterNameSuggestions(cards, value.characterName);
  const rarityOptions = getRaritiesForCharacter(cards, value.characterName);
  const cardIdOptions = getCardIdsForMetadata(cards, value.characterName, value.rarity);
  const selectorClassName = ['card-metadata-selector', className].filter(Boolean).join(' ');

  function updateCharacterName(characterName: string) {
    onChange({ characterName, rarity: '', cardId: '' });
    setShowCharacterSuggestions(true);
  }

  return (
    <div className={selectorClassName}>
      <div className="card-metadata-selector__character">
        <label>
          <FieldLabel required={required}>角色／人名</FieldLabel>
          <input
            aria-label="角色／人名"
            value={value.characterName}
            onChange={(event) => updateCharacterName(event.target.value)}
            onFocus={() => setShowCharacterSuggestions(true)}
            autoComplete="off"
            placeholder="輸入角色／人名"
            aria-controls="card-metadata-character-options"
            aria-expanded={showCharacterSuggestions && characterSuggestions.length > 0}
            required={required}
          />
        </label>
        {showCharacterSuggestions && characterSuggestions.length > 0 && (
          <ul className="character-suggestions" id="card-metadata-character-options" aria-label="角色／人名候選">
            {characterSuggestions.map((name) => (
              <li key={name}>
                <button type="button" onClick={() => {
                  onChange({ characterName: name, rarity: '', cardId: '' });
                  setShowCharacterSuggestions(false);
                }}>
                  {name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

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
