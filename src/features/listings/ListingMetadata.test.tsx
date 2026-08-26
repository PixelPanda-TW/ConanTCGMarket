// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Listing } from '../../domain/models';
import { ListingMetadata } from './ListingMetadata';

const baseListing: Listing = {
  id: 'listing-1',
  sellerId: 'seller-1',
  cardId: '0338',
  cardType: 'character',
  cardName: '諸伏景光',
  characterName: '諸伏景光',
  rarity: 'R',
  imageUrls: ['https://example.com/card.jpg'],
  listingPrice: 500,
  originalQuantity: 1,
  remainingQuantity: 1,
  hasSleeve: false,
  supportsMyShip: false,
  status: 'active',
  createdAt: new Date(),
  updatedAt: new Date(),
};

afterEach(cleanup);

describe('ListingMetadata', () => {
  it.each([
    ['character', '角色卡', '諸伏景光', 'R', '0338'],
    ['event', '事件卡', '追跡開始', 'C', '1100'],
    ['case', 'Case 卡（情境卡）', '封鎖現場', 'SR', '2200'],
    ['partner', 'Partner 卡（拍檔卡）', '小蘭', 'P', '3300'],
  ] as const)('renders the approved %s card metadata', (cardType, label, cardName, rarity, cardId) => {
    render(<ListingMetadata listing={{ ...baseListing, cardType, cardName, rarity, cardId, characterName: cardType === 'character' ? cardName : undefined }} />);

    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByRole('heading', { name: cardName })).toBeTruthy();
    expect(screen.getByText(`${rarity} · ID ${cardId}`)).toBeTruthy();
  });

  it('presents a legacy characterName-only Listing as a character card', () => {
    render(<ListingMetadata listing={{ ...baseListing, cardType: undefined, cardName: undefined }} />);

    expect(screen.getByText('角色卡')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '諸伏景光' })).toBeTruthy();
    expect(screen.getByText('R · ID 0338')).toBeTruthy();
  });
});
