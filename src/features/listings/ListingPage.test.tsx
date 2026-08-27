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

const cards: Card[] = [
  { key: 'character_0338', cardId: '0338', cardType: 'character', cardName: '諸伏景光', rarities: ['R'] },
  { key: 'event_1100', cardId: '1100', cardType: 'event', cardName: '追跡開始', rarities: ['C'] },
  { key: 'case_1200', cardId: '1200', cardType: 'case', cardName: '緋色の真相', rarities: ['C'] },
  { key: 'partner_P001', cardId: 'P001', cardType: 'partner', cardName: '江戶川柯南', rarities: ['P'] },
];
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

describe('ListingPage card-name subscriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repositories.getListing.mockResolvedValue(listing);
    repositories.listCards.mockResolvedValue(cards);
    repositories.getPublicSellerProfile.mockResolvedValue(seller);
  });

  it.each([
    ['character', '諸伏景光', '0338', 'R'],
    ['event', '追跡開始', '1100', 'C'],
    ['case', '緋色の真相', '1200', 'C'],
    ['partner', '江戶川柯南', 'P001', 'P'],
  ] as const)('offers notification subscription for a resolved %s snapshot', async (cardType, cardName, cardId, rarity) => {
    repositories.getListing.mockResolvedValue({
      ...listing,
      cardType,
      cardName,
      cardId,
      rarity,
    });

    render(<ListingPage id={`listing-${cardType}`} />);

    expect(await screen.findByRole('button', { name: `訂閱${cardName}` })).toBeTruthy();
  });

  it('does not offer notification subscription for a snapshot name absent from Card Master', async () => {
    repositories.getListing.mockResolvedValue({ ...listing, cardType: 'character', cardName: '諸伏' });

    render(<ListingPage id="listing-1" />);

    expect(await screen.findByRole('heading', { name: '諸伏' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /訂閱諸伏/ })).toBeNull();
  });

  it('hides the previous card-name control immediately when navigating to another listing', async () => {
    const view = render(<ListingPage id="listing-1" />);
    expect(await screen.findByRole('button', { name: '訂閱諸伏景光' })).toBeTruthy();
    repositories.getListing.mockResolvedValueOnce({
      ...listing,
      id: 'listing-2',
      cardType: 'character',
      cardName: '諸伏',
    });
    repositories.listCards.mockReturnValueOnce(new Promise(() => undefined));

    view.rerender(<ListingPage id="listing-2" />);

    expect(await screen.findByRole('heading', { name: '諸伏' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /訂閱諸伏/ })).toBeNull();
  });

  it('shows ambiguity and no subscription for ambiguous legacy metadata', async () => {
    repositories.getListing.mockResolvedValue({
      ...listing,
      cardId: '0501',
      characterName: undefined,
      rarity: undefined,
    });
    repositories.listCards.mockResolvedValue([
      { key: 'card_character', cardId: '0501', cardType: 'character', cardName: '諸伏高明', rarities: ['D'] },
      { key: 'card_event', cardId: '0501', cardType: 'event', cardName: '事件 0501', rarities: ['C'] },
    ]);

    render(<ListingPage id="listing-1" />);

    expect(await screen.findByRole('heading', { name: '卡片資料不明確' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /訂閱/ })).toBeNull();
  });

  it('shows unavailable metadata and no subscription when a legacy card cannot be resolved', async () => {
    repositories.getListing.mockResolvedValue({
      ...listing,
      cardId: '9999',
      characterName: undefined,
      cardType: undefined,
      cardName: undefined,
      rarity: undefined,
    });

    render(<ListingPage id="listing-missing" />);

    expect(await screen.findByRole('heading', { name: '未提供卡片名稱' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /訂閱/ })).toBeNull();
  });
});
