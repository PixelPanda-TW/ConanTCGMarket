// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { listCardsMock } = vi.hoisted(() => ({ listCardsMock: vi.fn() }));

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ user: { uid: 'seller-1' }, isLoading: false }),
}));

vi.mock('../../data/firestore/repositories', () => ({
  createListing: vi.fn(),
  createListingId: vi.fn(),
  getSellerProfile: vi.fn(),
  listCards: listCardsMock,
}));

import { SellPage } from './SellPage';

afterEach(() => {
  cleanup();
  listCardsMock.mockReset();
});

describe('SellPage', () => {
  it('renders an independent back-to-market link with an arrow before the listing title', async () => {
    listCardsMock.mockResolvedValue([]);
    render(<SellPage loadSellerProfile={async () => ({ uid: 'seller-1', displayName: 'Seller', contactType: 'line', contactValue: 'seller-line', createdAt: new Date(), updatedAt: new Date() })} />);

    const backLink = await screen.findByRole('link', { name: '← 返回市集' });
    expect(backLink.getAttribute('href')).toBe('#');
    expect(backLink.compareDocumentPosition(screen.getByRole('heading', { name: '刊登商品' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('preloads Card Master and narrows the rarity and ID autocomplete options', async () => {
    listCardsMock.mockResolvedValue([
      { id: '0338', characterName: '諸伏景光', rarities: ['R', 'CP'] },
      { id: '0590', characterName: '諸伏景光', rarities: ['R'] },
      { id: '1010', characterName: '諸伏高明', rarities: ['SR'] },
    ]);

    render(<SellPage loadSellerProfile={async () => ({ uid: 'seller-1', displayName: 'Seller', contactType: 'line', contactValue: 'seller-line', createdAt: new Date(), updatedAt: new Date() })} />);

    await waitFor(() => expect(listCardsMock).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('角色／人名'), { target: { value: '諸伏' } });
    expect(screen.getByRole('button', { name: '諸伏景光' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '諸伏高明' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '諸伏景光' }));
    fireEvent.change(screen.getByLabelText('稀有度'), { target: { value: 'R' } });

    expect([...screen.getByLabelText('稀有度').querySelectorAll('option')].map((option) => option.getAttribute('value'))).toEqual(['', 'CP', 'R']);
    expect([...screen.getByLabelText('卡片 ID').querySelectorAll('option')].map((option) => option.getAttribute('value'))).toEqual(['', '0338', '0590']);
  });
});
