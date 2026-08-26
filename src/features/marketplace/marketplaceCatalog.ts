import type { Card, Listing } from '../../domain/models';
import {
  findCardsByVisibleId,
  resolveListingMetadata,
  type ResolvedListingMetadata,
} from '../../domain/listingMetadata';

function marketplaceCandidates(
  cardId: string,
  cardMaster: readonly Card[],
  fallbackCards: readonly Card[],
): Card[] {
  const firestoreCandidates = findCardsByVisibleId(cardMaster, cardId);
  return firestoreCandidates.length > 0
    ? firestoreCandidates
    : findCardsByVisibleId(fallbackCards, cardId);
}

export function resolveMarketplaceListingMetadata(
  listing: Listing,
  cardMaster: readonly Card[],
  fallbackCards: readonly Card[],
): ResolvedListingMetadata {
  return resolveListingMetadata(listing, marketplaceCandidates(listing.cardId, cardMaster, fallbackCards));
}
