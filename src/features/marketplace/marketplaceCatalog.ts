import type { Card } from '../../domain/models';

export function resolveListingCard(cardId: string, cardMaster: readonly Card[], fallbackCards: readonly Card[]): Card | null {
  return cardMaster.find((card) => card.id === cardId) ?? fallbackCards.find((card) => card.id === cardId) ?? null;
}
