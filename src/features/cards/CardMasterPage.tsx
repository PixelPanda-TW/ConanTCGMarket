import { useEffect, useState } from 'react';
import { listCards } from '../../data/firestore/repositories';
import { cardTypeLabel } from '../../domain/cardType';
import type { Card } from '../../domain/models';
import { CardSelector } from './CardSelector';
import { PageShell } from '../../components/PageShell';

type CardMasterState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; cards: readonly Card[] };

interface CardMasterPageProps {
  loadCards?: () => Promise<readonly Card[]>;
}

function cardName(card: Card): string {
  return card.cardName;
}

function cardRarities(card: Card): string {
  return card.rarities.join('、');
}

export function CardMasterPage({ loadCards = listCards }: CardMasterPageProps) {
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
    <PageShell width="wide-form" backToMarketplace>
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
        ) : cardState.cards.length === 0 ? (
          <p className="card-master-state" role="status">目前沒有可顯示的卡牌資料。</p>
        ) : (
          <>
            <CardSelector cards={cardState.cards} value={selectedCard} onChange={setSelectedCard} />
            {selectedCard && (
              <section className="selected-card-summary" aria-live="polite">
                <h2>已選擇卡牌</h2>
                <dl>
                  <div>
                    <dt>卡號</dt>
                    <dd>{selectedCard.cardId}</dd>
                  </div>
                  <div>
                    <dt>卡片類型</dt>
                    <dd>{cardTypeLabel(selectedCard.cardType)}</dd>
                  </div>
                  <div>
                    <dt>卡片名稱</dt>
                    <dd>{cardName(selectedCard)}</dd>
                  </div>
                  <div>
                    <dt>稀有度</dt>
                    <dd>{cardRarities(selectedCard)}</dd>
                  </div>
                </dl>
                <p>{cardName(selectedCard)} 已作為完整卡牌物件選擇。</p>
              </section>
            )}
          </>
        )}
      </section>
    </PageShell>
  );
}
