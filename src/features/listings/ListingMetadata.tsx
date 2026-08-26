import { cardTypeLabel, isCardType, type CardType } from '../../domain/cardType';
import type { Card, Listing } from '../../domain/models';

export interface ResolvedListingMetadata {
  cardType?: CardType;
  cardName: string;
  rarity: string;
  cardId: string;
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function resolveListingMetadata(listing: Listing, card?: Card | null): ResolvedListingMetadata {
  const hasListingMetadata = isCardType(listing.cardType) && hasText(listing.cardName);
  const isLegacyCharacter = !hasListingMetadata && hasText(listing.characterName);
  const cardType = hasListingMetadata
    ? listing.cardType
    : isLegacyCharacter
      ? 'character'
      : card?.cardType;
  const cardName = hasListingMetadata
    ? listing.cardName
    : isLegacyCharacter
      ? listing.characterName
      : card?.cardName;

  return {
    cardType,
    cardName: cardName ?? '未提供卡片名稱',
    rarity: hasText(listing.rarity) ? listing.rarity : card?.rarities[0] ?? '未提供稀有度',
    cardId: hasText(listing.cardId) ? listing.cardId : card?.id ?? '未提供卡片 ID',
  };
}

interface ListingMetadataProps {
  listing: Listing;
  card?: Card | null;
  compact?: boolean;
}

export function ListingMetadata({ listing, card, compact = false }: ListingMetadataProps) {
  const metadata = resolveListingMetadata(listing, card);

  return (
    <div className={`listing-metadata${compact ? ' listing-metadata--compact' : ''}`}>
      <p className="card-type-badge">{metadata.cardType ? cardTypeLabel(metadata.cardType) : '未提供卡片類型'}</p>
      <h2>{metadata.cardName}</h2>
      <p className="listing-metadata__details">{metadata.rarity} · ID {metadata.cardId}</p>
    </div>
  );
}
