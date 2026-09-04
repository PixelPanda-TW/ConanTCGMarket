// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createListingIdMock,
  createListingMock,
  listCardsMock,
  uploadListingImagesMock,
} = vi.hoisted(() => ({
  createListingIdMock: vi.fn(),
  createListingMock: vi.fn(),
  listCardsMock: vi.fn(),
  uploadListingImagesMock: vi.fn(),
}));

const authState = vi.hoisted(() => ({
  current: {
    user: { uid: 'seller-1' } as { uid: string } | null,
    isLoading: false,
    accountAccessState: { state: 'active', access: null } as Record<string, unknown>,
    isActiveAccount: true,
  },
}));

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => authState.current,
}));

vi.mock('../../data/firestore/repositories', () => ({
  createListing: createListingMock,
  createListingId: createListingIdMock,
  getSellerProfile: vi.fn(),
  listCards: listCardsMock,
}));

vi.mock('../../data/storage/storageService', () => ({
  uploadListingImages: uploadListingImagesMock,
}));

import { SellPage } from './SellPage';

const loadSellerProfile = vi.fn(async () => ({
  uid: 'seller-1', displayName: 'Seller', contactType: 'line' as const, contactValue: 'seller-line', createdAt: new Date(), updatedAt: new Date(),
}));

afterEach(() => {
  cleanup();
  createListingIdMock.mockReset();
  createListingMock.mockReset();
  listCardsMock.mockReset();
  uploadListingImagesMock.mockReset();
});

describe('SellPage', () => {
  beforeEach(() => {
    authState.current = {
      user: { uid: 'seller-1' },
      isLoading: false,
      accountAccessState: { state: 'active', access: null },
      isActiveAccount: true,
    };
    loadSellerProfile.mockClear();
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
  ])('blocks %s accounts before loading profile or Card Master data', (_label, accountAccessState) => {
    authState.current.accountAccessState = accountAccessState;
    authState.current.isActiveAccount = false;

    render(<SellPage loadSellerProfile={loadSellerProfile} />);

    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '建立刊登' })).toBeNull();
    expect(loadSellerProfile).not.toHaveBeenCalled();
    expect(listCardsMock).not.toHaveBeenCalled();
    expect(uploadListingImagesMock).not.toHaveBeenCalled();
    expect(createListingMock).not.toHaveBeenCalled();
  });

  it('requires both protected profile halves before enabling selling', async () => {
    listCardsMock.mockResolvedValue([]);
    const incompleteProfile = vi.fn(async () => null);
    render(<SellPage loadSellerProfile={incompleteProfile} />);

    expect(await screen.findByText('請先完成賣家個人檔案，才能刊登商品。')).toBeTruthy();
    expect(screen.getByRole('link', { name: '前往設定個人檔案' }).getAttribute('href')).toBe('#/profile');
    expect(screen.queryByRole('button', { name: '建立刊登' })).toBeNull();
  });

  it('renders an independent back-to-market link with an arrow before the listing title', async () => {
    listCardsMock.mockResolvedValue([]);
    render(<SellPage loadSellerProfile={loadSellerProfile} />);

    const backLink = await screen.findByRole('link', { name: '← 返回市集' });
    expect(backLink.getAttribute('href')).toBe('#');
    expect(backLink.compareDocumentPosition(screen.getByRole('heading', { name: '刊登商品' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('preloads Card Master and narrows the rarity and ID autocomplete options', async () => {
    listCardsMock.mockResolvedValue([
      { key: 'character_0338', cardId: '0338', cardType: 'character', cardName: '諸伏景光', rarities: ['R', 'CP'] },
      { key: 'character_0590', cardId: '0590', cardType: 'character', cardName: '諸伏景光', rarities: ['R'] },
      { key: 'character_1010', cardId: '1010', cardType: 'character', cardName: '諸伏高明', rarities: ['SR'] },
    ]);

    render(<SellPage loadSellerProfile={loadSellerProfile} />);

    await waitFor(() => expect(listCardsMock).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('卡片名稱').closest('.card-metadata-selector')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('卡片名稱'), { target: { value: '諸伏' } });
    expect([...document.querySelectorAll('datalist option')].map((option) => option.getAttribute('value'))).toEqual(['諸伏景光', '諸伏高明']);
    fireEvent.change(screen.getByLabelText('卡片名稱'), { target: { value: '諸伏景光' } });
    fireEvent.change(screen.getByLabelText('稀有度'), { target: { value: 'R' } });

    expect([...screen.getByLabelText('稀有度').querySelectorAll('option')].map((option) => option.getAttribute('value'))).toEqual(['', 'CP', 'R']);
    expect([...document.querySelectorAll('#card-metadata-id-options option')].map((option) => option.getAttribute('value'))).toEqual(['0338', '0590']);
  });

  it('creates a partner Listing with the normalized visible ID and no internal key', async () => {
    listCardsMock.mockResolvedValue([{ key: 'card_partner', cardId: 'P001', cardType: 'partner', cardName: '江戶川柯南', rarities: ['P'] }]);
    createListingIdMock.mockReturnValue('listing-partner');
    uploadListingImagesMock.mockResolvedValue(['https://example.com/partner.jpg']);
    createListingMock.mockResolvedValue('listing-partner');
    render(<SellPage loadSellerProfile={loadSellerProfile} />);

    await screen.findByLabelText('卡片類型');
    fireEvent.change(screen.getByLabelText('卡片類型'), { target: { value: 'partner' } });
    fireEvent.change(screen.getByLabelText('卡片名稱'), { target: { value: '江戶川柯南' } });
    fireEvent.change(screen.getByLabelText('稀有度'), { target: { value: 'P' } });
    fireEvent.change(screen.getByLabelText('卡片 ID'), { target: { value: 'p001' } });
    fireEvent.change(screen.getByLabelText('商品圖片'), { target: { files: [new File(['image'], 'partner.png', { type: 'image/png' })] } });
    fireEvent.change(screen.getByLabelText('價格'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('數量'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: '建立刊登' }));

    await waitFor(() => expect(createListingMock).toHaveBeenCalledTimes(1));
    expect(createListingIdMock).toHaveBeenCalledTimes(1);
    expect(uploadListingImagesMock).toHaveBeenCalledTimes(1);
    const listing = createListingMock.mock.calls[0][0];
    expect(listing).toEqual(expect.objectContaining({
      cardId: 'P001', cardType: 'partner', cardName: '江戶川柯南', rarity: 'P',
    }));
    expect(listing).not.toHaveProperty('key');
    expect(listing).not.toHaveProperty('cardKey');
  });

  it('creates an event Listing snapshot without characterName', async () => {
    listCardsMock.mockResolvedValue([{ key: 'event_1100', cardId: '1100', cardType: 'event', cardName: '追跡開始', rarities: ['C'] }]);
    createListingIdMock.mockReturnValue('listing-event');
    uploadListingImagesMock.mockResolvedValue(['https://example.com/event.jpg']);
    createListingMock.mockResolvedValue('listing-event');
    render(<SellPage loadSellerProfile={loadSellerProfile} />);

    await screen.findByLabelText('卡片類型');
    fireEvent.change(screen.getByLabelText('卡片類型'), { target: { value: 'event' } });
    fireEvent.change(screen.getByLabelText('卡片名稱'), { target: { value: '追跡開始' } });
    fireEvent.change(screen.getByLabelText('稀有度'), { target: { value: 'C' } });
    fireEvent.change(screen.getByLabelText('卡片 ID'), { target: { value: '1100' } });
    fireEvent.change(screen.getByLabelText('商品圖片'), { target: { files: [new File(['image'], 'event.png', { type: 'image/png' })] } });
    fireEvent.change(screen.getByLabelText('價格'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('數量'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: '建立刊登' }));

    await waitFor(() => expect(createListingMock).toHaveBeenCalledTimes(1));
    expect(createListingMock).toHaveBeenCalledWith(expect.objectContaining({
      cardId: '1100', cardType: 'event', cardName: '追跡開始', rarity: 'C',
    }));
    expect(createListingMock.mock.calls[0][0]).not.toHaveProperty('characterName');
  });

  it('creates a character Listing snapshot whose characterName matches cardName', async () => {
    listCardsMock.mockResolvedValue([{ key: 'character_1096', cardId: '1096', cardType: 'character', cardName: '鈴木園子', rarities: ['SR'] }]);
    createListingIdMock.mockReturnValue('listing-character');
    uploadListingImagesMock.mockResolvedValue(['https://example.com/character.jpg']);
    createListingMock.mockResolvedValue('listing-character');
    render(<SellPage loadSellerProfile={loadSellerProfile} />);

    await screen.findByLabelText('卡片名稱');
    fireEvent.change(screen.getByLabelText('卡片名稱'), { target: { value: '鈴木園子' } });
    fireEvent.change(screen.getByLabelText('稀有度'), { target: { value: 'SR' } });
    fireEvent.change(screen.getByLabelText('卡片 ID'), { target: { value: '1096' } });
    fireEvent.change(screen.getByLabelText('商品圖片'), { target: { files: [new File(['image'], 'character.png', { type: 'image/png' })] } });
    fireEvent.change(screen.getByLabelText('價格'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('數量'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: '建立刊登' }));

    await waitFor(() => expect(createListingMock).toHaveBeenCalledTimes(1));
    expect(createListingMock).toHaveBeenCalledWith(expect.objectContaining({
      cardType: 'character', cardName: '鈴木園子', characterName: '鈴木園子',
    }));
  });

  it('rejects an unknown metadata combination before uploading images', async () => {
    listCardsMock.mockResolvedValue([{ key: 'event_1100', cardId: '1100', cardType: 'event', cardName: '追跡開始', rarities: ['C'] }]);
    render(<SellPage loadSellerProfile={loadSellerProfile} />);

    await screen.findByLabelText('卡片類型');
    fireEvent.change(screen.getByLabelText('卡片類型'), { target: { value: 'event' } });
    fireEvent.change(screen.getByLabelText('卡片名稱'), { target: { value: '追跡開始' } });
    fireEvent.change(screen.getByLabelText('稀有度'), { target: { value: 'C' } });
    fireEvent.change(screen.getByLabelText('卡片 ID'), { target: { value: '9999' } });
    fireEvent.change(screen.getByLabelText('商品圖片'), { target: { files: [new File(['image'], 'event.png', { type: 'image/png' })] } });
    fireEvent.change(screen.getByLabelText('價格'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('數量'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: '建立刊登' }));

    expect((await screen.findByRole('alert')).textContent).toContain('資料庫找不到這組卡片類型、卡片名稱、稀有度與 ID，請確認後再試。');
    expect(createListingIdMock).not.toHaveBeenCalled();
    expect(uploadListingImagesMock).not.toHaveBeenCalled();
    expect(createListingMock).not.toHaveBeenCalled();
  });
});
