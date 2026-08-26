// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Listing } from '../../domain/models';
import { ListingEditPage } from './ListingEditPage';

const repositories = vi.hoisted(() => ({
  deleteListing: vi.fn(),
  getListing: vi.fn(),
  listCards: vi.fn(),
  updateListing: vi.fn(),
}));

vi.mock('../../data/firestore/repositories', () => repositories);
vi.mock('../../data/storage/storageService', () => ({
  deleteListingImages: vi.fn(),
  uploadListingImages: vi.fn(),
}));
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ user: { uid: 'seller-1' }, isLoading: false }),
}));

const listing: Listing = {
  id: 'listing-event',
  sellerId: 'seller-1',
  cardId: '1100',
  cardType: 'event',
  cardName: '追跡開始',
  rarity: 'C',
  imageUrls: ['https://example.com/event.jpg'],
  listingPrice: 500,
  originalQuantity: 2,
  remainingQuantity: 2,
  hasSleeve: false,
  supportsMyShip: false,
  status: 'active',
  createdAt: new Date(),
  updatedAt: new Date(),
};

afterEach(cleanup);

describe('ListingEditPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repositories.getListing.mockResolvedValue(listing);
    repositories.listCards.mockResolvedValue([]);
    repositories.updateListing.mockResolvedValue(undefined);
  });

  it('shows immutable metadata read-only and preserves it in the update', async () => {
    render(<ListingEditPage id="listing-event" />);

    expect(await screen.findByText('事件卡')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '追跡開始' })).toBeTruthy();
    expect(screen.getByText('C · ID 1100')).toBeTruthy();
    expect(screen.queryByLabelText('卡片類型')).toBeNull();
    expect(screen.queryByLabelText('卡片名稱')).toBeNull();
    expect(screen.queryByLabelText('稀有度')).toBeNull();
    expect(screen.queryByLabelText('卡片 ID')).toBeNull();

    fireEvent.change(screen.getByLabelText('價格'), { target: { value: '600' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存變更' }));

    await waitFor(() => expect(repositories.updateListing).toHaveBeenCalledWith(expect.objectContaining({
      cardId: '1100',
      cardType: 'event',
      cardName: '追跡開始',
      rarity: 'C',
    })));
    expect(repositories.updateListing.mock.calls[0][0]).not.toHaveProperty('characterName');
  });

  it('preserves characterName when saving an immutable character Listing', async () => {
    repositories.getListing.mockResolvedValue({
      ...listing,
      id: 'listing-character',
      cardId: '0338',
      cardType: 'character',
      cardName: '諸伏景光',
      characterName: '諸伏景光',
      rarity: 'R',
    });

    render(<ListingEditPage id="listing-character" />);

    await screen.findByText('角色卡');
    fireEvent.change(screen.getByLabelText('價格'), { target: { value: '600' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存變更' }));

    await waitFor(() => expect(repositories.updateListing).toHaveBeenCalledWith(expect.objectContaining({
      cardId: '0338',
      cardType: 'character',
      cardName: '諸伏景光',
      rarity: 'R',
      characterName: '諸伏景光',
    })));
  });

  it('resolves cardId-only legacy metadata from Card Master without blocking editing', async () => {
    repositories.getListing.mockResolvedValue({
      ...listing,
      id: 'legacy-listing',
      cardId: 'CT-P01-001',
      cardType: undefined,
      cardName: undefined,
      rarity: undefined,
    });
    repositories.listCards.mockResolvedValue([
      { key: 'event_CT-P01-001', cardId: 'CT-P01-001', cardType: 'event', cardName: '舊版事件', rarities: ['CP'] },
    ]);

    render(<ListingEditPage id="legacy-listing" />);

    expect(await screen.findByText('事件卡')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '舊版事件' })).toBeTruthy();
    expect(screen.getByText('CP · ID CT-P01-001')).toBeTruthy();
    expect(screen.getByRole('button', { name: '儲存變更' })).toBeTruthy();
  });
});
