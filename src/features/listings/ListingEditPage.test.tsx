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
const storage = vi.hoisted(() => ({
  deleteListingImages: vi.fn(),
  uploadListingImages: vi.fn(),
}));
const authState = vi.hoisted(() => ({
  current: {
    user: { uid: 'seller-1' } as { uid: string } | null,
    isLoading: false,
    accountAccessState: { state: 'active', access: null } as Record<string, unknown>,
    isActiveAccount: true,
  },
}));

vi.mock('../../data/firestore/repositories', () => repositories);
vi.mock('../../data/storage/storageService', () => storage);
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => authState.current,
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
    authState.current.user = { uid: 'seller-1' };
    authState.current.accountAccessState = { state: 'active', access: null };
    authState.current.isActiveAccount = true;
  });

  it.each([
    ['suspended', {
      state: 'suspended',
      access: {
        uid: 'seller-1', status: 'suspended', confirmedViolationCount: 1,
        suspensionReason: 'Reason', suspendedAt: new Date(), suspendedBy: 'admin-1',
        updatedAt: new Date(),
      },
    }],
    ['unavailable', { state: 'unavailable', message: '請重新整理。' }],
  ])('blocks %s accounts before loading an editable Listing', (_label, accountAccessState) => {
    authState.current.accountAccessState = accountAccessState;
    authState.current.isActiveAccount = false;

    render(<ListingEditPage id="listing-event" />);

    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '儲存變更' })).toBeNull();
    expect(repositories.getListing).not.toHaveBeenCalled();
    expect(repositories.listCards).not.toHaveBeenCalled();
    expect(repositories.updateListing).not.toHaveBeenCalled();
    expect(repositories.deleteListing).not.toHaveBeenCalled();
    expect(storage.uploadListingImages).not.toHaveBeenCalled();
    expect(storage.deleteListingImages).not.toHaveBeenCalled();
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
      cardId: '0501',
      cardType: undefined,
      cardName: undefined,
      rarity: undefined,
    });
    repositories.listCards.mockResolvedValue([
      { key: 'card_event', cardId: '0501', cardType: 'event', cardName: '舊版事件', rarities: ['CP'] },
    ]);

    render(<ListingEditPage id="legacy-listing" />);

    expect(await screen.findByText('事件卡')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '舊版事件' })).toBeTruthy();
    expect(screen.getByText('CP · ID 0501')).toBeTruthy();
    expect(screen.getByRole('button', { name: '儲存變更' })).toBeTruthy();
  });

  it('keeps ambiguous immutable metadata unresolved when saving mutable fields', async () => {
    const legacyListing = {
      id: 'legacy-listing',
      sellerId: 'seller-1',
      cardId: '0501',
      imageUrls: ['https://example.com/event.jpg'],
      listingPrice: 500,
      originalQuantity: 2,
      remainingQuantity: 2,
      hasSleeve: false,
      supportsMyShip: false,
      status: 'active' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    repositories.getListing.mockResolvedValue(legacyListing);
    repositories.listCards.mockResolvedValue([
      { key: 'card_character', cardId: '0501', cardType: 'character', cardName: '諸伏高明', rarities: ['D'] },
      { key: 'card_event', cardId: '0501', cardType: 'event', cardName: '事件 0501', rarities: ['C'] },
    ]);

    render(<ListingEditPage id="legacy-listing" />);

    expect(await screen.findByRole('heading', { name: '卡片資料不明確' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('價格'), { target: { value: '600' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存變更' }));

    await waitFor(() => expect(repositories.updateListing).toHaveBeenCalledTimes(1));
    const savedListing = repositories.updateListing.mock.calls[0][0];
    expect(savedListing).toMatchObject({ cardId: '0501', listingPrice: 600 });
    expect(savedListing).not.toHaveProperty('cardType');
    expect(savedListing).not.toHaveProperty('cardName');
    expect(savedListing).not.toHaveProperty('rarity');
    expect(savedListing).not.toHaveProperty('characterName');
  });
});
