// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Card, Listing, SellerProfile } from '../../domain/models';
import { MarketplacePage } from './MarketplacePage';

vi.mock('../auth/AuthStatus', () => ({
  AuthStatus: () => <div>auth status</div>,
}));

const cards: Card[] = [
  { id: '0338', characterName: '諸伏景光', rarities: ['R', 'CP'] },
  { id: '0590', characterName: '諸伏景光', rarities: ['R'] },
  { id: '1010', characterName: '諸伏高明', rarities: ['SR'] },
];

const activeListing: Listing = {
  id: 'listing-1',
  sellerId: 'seller-1',
  cardId: '0338',
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

const seller: SellerProfile = {
  uid: 'seller-1',
  displayName: '賣家 A',
  contactType: 'line',
  contactValue: 'seller-a',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('MarketplacePage', () => {
  it('shows only active listings and narrows card metadata filters from a selected character', async () => {
    render(
      <MarketplacePage
        loadListings={async () => [activeListing, { ...activeListing, id: 'sold-out', status: 'sold_out' }]}
        loadCards={async () => cards}
        loadSeller={async () => seller}
      />,
    );

    expect(await screen.findByRole('heading', { name: '諸伏景光' })).toBeTruthy();
    expect(screen.queryByText('sold-out')).toBeNull();

    fireEvent.change(screen.getByLabelText('角色／人名'), { target: { value: '諸伏' } });
    expect(screen.getByRole('button', { name: '諸伏景光' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '諸伏高明' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '諸伏景光' }));
    expect((screen.getByLabelText('角色／人名') as HTMLInputElement).value).toBe('諸伏景光');
    expect([...screen.getByLabelText('稀有度').querySelectorAll('option')].map((option) => option.value)).toEqual(['', 'CP', 'R']);

    fireEvent.change(screen.getByLabelText('稀有度'), { target: { value: 'R' } });
    expect([...screen.getByLabelText('卡片 ID').querySelectorAll('option')].map((option) => option.value)).toEqual(['', '0338', '0590']);
  });
});
