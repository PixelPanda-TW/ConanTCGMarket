import { useMemo, useState } from 'react';
import type { Card } from '../../domain/models';
import { searchCards } from '../../data/cards/cardSearch';

interface CardSelectorProps {
  cards: readonly Card[];
  value: Card | null;
  onChange: (card: Card | null) => void;
}

function cardName(card: Card): string {
  return card.nameZh ?? card.nameJa ?? card.id;
}

export function CardSelector({ cards, value, onChange }: CardSelectorProps) {
  const [query, setQuery] = useState('');
  const matchingCards = useMemo(() => searchCards(cards, query), [cards, query]);

  return (
    <div className="card-selector">
      <label className="card-selector-search">
        搜尋卡牌
        <input
          aria-label="搜尋卡牌"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜尋中文或日文卡名"
        />
      </label>

      {value && (
        <div className="card-selector-selected" aria-live="polite">
          <p>
            已選擇：{cardName(value)} · {value.rarity}
          </p>
          <button type="button" onClick={() => onChange(null)} aria-label="清除已選擇的卡牌">
            清除
          </button>
        </div>
      )}

      <div className="card-selector-results" aria-label="卡牌搜尋結果">
        {matchingCards.length === 0 ? (
          <p className="card-selector-empty" role="status">
            找不到符合的卡牌。
          </p>
        ) : (
          matchingCards.map((card) => (
            <button
              type="button"
              className="card-selector-option"
              key={card.id}
              onClick={() => onChange(card)}
              aria-label={`${cardName(card)} · ${card.rarity}`}
            >
              <span>{cardName(card)}</span>
              <span className="card-selector-rarity">{card.rarity}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
