import { cardTypeLabel } from '../../domain/cardType';
import type { Card, Listing } from '../../domain/models';
import { resolveListingMetadata } from '../../domain/listingMetadata';

export { resolveListingMetadata } from '../../domain/listingMetadata';
export type { ResolvedListingMetadata } from '../../domain/listingMetadata';

interface ListingMetadataProps {
  listing: Listing;
  cards?: readonly Card[];
  compact?: boolean;
}

export function ListingMetadata({ listing, cards = [], compact = false }: ListingMetadataProps) {
  const metadata = resolveListingMetadata(listing, cards);

  return (
    <div className={`listing-metadata${compact ? ' listing-metadata--compact' : ''}`}>
      <p className="card-type-badge">{metadata.cardType ? cardTypeLabel(metadata.cardType) : '未提供卡片類型'}</p>
      <h2>{metadata.cardName}</h2>
      <p className="listing-metadata__details">{metadata.rarity} · ID {metadata.cardId}</p>
    </div>
  );
}
