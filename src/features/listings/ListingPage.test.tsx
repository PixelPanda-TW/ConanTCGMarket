// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card, Listing, SellerProfile } from '../../domain/models';
import { ListingPage } from './ListingPage';

const repositories = vi.hoisted(() => ({
  getListing: vi.fn(),
  getPublicSellerProfile: vi.fn(),
  listCards: vi.fn(),
}));

vi.mock('../../data/firestore/repositories', () => repositories);
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({
    user: null,
    isLoading: false,
    error: null,
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));

const card: Card = { id: '0338', cardType: 'character', cardName: '諸伏景光', rarities: ['R'] };
const listing: Listing = {
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
  displayName: 'Seller',
  contactType: 'line',
  contactValue: 'seller',
  createdAt: new Date(),
  updatedAt: new Date(),
};

afterEach(cleanup);

describe('ListingPage character subscriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repositories.getListing.mockResolvedValue(listing);
    repositories.listCards.mockResolvedValue([card]);
    repositories.getPublicSellerProfile.mockResolvedValue(seller);
  });

  it('offers notification subscription for an exact known listing snapshot character', async () => {
    render(<ListingPage id="listing-1" />);

    expect(await screen.findByRole('button', { name: '訂閱諸伏景光' })).toBeTruthy();
  });

  it('does not offer notification subscription for an incomplete listing snapshot character', async () => {
    repositories.getListing.mockResolvedValue({ ...listing, characterName: '諸伏' });

    render(<ListingPage id="listing-1" />);

    expect(await screen.findByRole('heading', { name: '諸伏' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /訂閱諸伏/ })).toBeNull();
  });

  it('hides the previous character control immediately when navigating to another listing', async () => {
    const view = render(<ListingPage id="listing-1" />);
    expect(await screen.findByRole('button', { name: '訂閱諸伏景光' })).toBeTruthy();
    repositories.getListing.mockResolvedValueOnce({
      ...listing,
      id: 'listing-2',
      characterName: '諸伏',
    });
    repositories.listCards.mockReturnValueOnce(new Promise(() => undefined));

    view.rerender(<ListingPage id="listing-2" />);

    expect(await screen.findByRole('heading', { name: '諸伏' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /訂閱諸伏/ })).toBeNull();
  });
});
