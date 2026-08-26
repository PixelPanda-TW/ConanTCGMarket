// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ user: { uid: 'seller-1' }, isLoading: false }),
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

const loadSellerProfile = async () => ({
  uid: 'seller-1', displayName: 'Seller', contactType: 'line' as const, contactValue: 'seller-line', createdAt: new Date(), updatedAt: new Date(),
});

afterEach(() => {
  cleanup();
  createListingIdMock.mockReset();
  createListingMock.mockReset();
  listCardsMock.mockReset();
  uploadListingImagesMock.mockReset();
});

describe('SellPage', () => {
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
    expect([...screen.getByLabelText('卡片 ID').querySelectorAll('option')].map((option) => option.getAttribute('value'))).toEqual(['', '0338', '0590']);
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
    const cardIdInput = screen.getByLabelText('卡片 ID') as HTMLSelectElement;
    cardIdInput.append(new Option('9999', '9999'));
    fireEvent.change(cardIdInput, { target: { value: '9999' } });
    fireEvent.change(screen.getByLabelText('商品圖片'), { target: { files: [new File(['image'], 'event.png', { type: 'image/png' })] } });
    fireEvent.change(screen.getByLabelText('價格'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('數量'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: '建立刊登' }));

    expect((await screen.findByRole('alert')).textContent).toContain('資料庫找不到這組卡片類型、卡片名稱、稀有度與 ID，請確認後再試。');
    expect(uploadListingImagesMock).not.toHaveBeenCalled();
    expect(createListingMock).not.toHaveBeenCalled();
  });
});
