import { useEffect, useState } from 'react';
import { developmentCards } from '../../data/cards/developmentCards';
import type { Card } from '../../domain/models';
import { CardSelector } from './CardSelector';
import { BackToMarketplaceLink } from '../../components/BackToMarketplaceLink';

type CardMasterState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; cards: readonly Card[] };

interface CardMasterPageProps {
  loadCards?: () => Promise<readonly Card[]>;
}

const loadDevelopmentCards = async (): Promise<readonly Card[]> => developmentCards;

function cardName(card: Card): string {
  return card.characterName ?? card.nameZh ?? card.nameJa ?? '未提供角色／人名';
}

export function CardMasterPage({ loadCards = loadDevelopmentCards }: CardMasterPageProps) {
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [cardState, setCardState] = useState<CardMasterState>({ status: 'loading' });

  useEffect(() => {
    let isCurrent = true;
    setCardState({ status: 'loading' });

    void loadCards()
      .then((cards) => {
        if (isCurrent) {
          setCardState({ status: 'ready', cards });
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          setCardState({
            status: 'error',
            message: error instanceof Error ? error.message : '無法載入卡牌資料。',
          });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [loadCards]);

  return (
    <main className="app-shell">
      <BackToMarketplaceLink />
      <section className="card-master-page">
        <p className="eyebrow">Card master</p>
        <h1>卡牌資料庫</h1>

        {cardState.status === 'loading' ? (
          <p className="card-master-state" aria-live="polite">
            載入卡牌資料中
          </p>
        ) : cardState.status === 'error' ? (
          <p className="card-master-state" role="alert">
            {cardState.message}
          </p>
        ) : (
          <>
            <CardSelector cards={cardState.cards} value={selectedCard} onChange={setSelectedCard} />
            {selectedCard && (
              <section className="selected-card-summary" aria-live="polite">
                <h2>已選擇卡牌</h2>
                <dl>
                  <div>
                    <dt>卡號</dt>
                    <dd>{selectedCard.id}</dd>
                  </div>
                  <div>
                    <dt>角色／人名</dt>
                    <dd>{cardName(selectedCard)}</dd>
                  </div>
                  <div>
                    <dt>稀有度</dt>
                    <dd>{selectedCard.rarity}</dd>
                  </div>
                </dl>
                <p>{cardName(selectedCard)} 已作為完整卡牌物件選擇。</p>
              </section>
            )}
          </>
        )}
      </section>
    </main>
  );
}
