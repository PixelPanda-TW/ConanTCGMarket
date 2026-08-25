// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { developmentCards } from './data/cards/developmentCards';
import App from './App';

const { listCards, listActiveListings, getPublicSellerProfile } = vi.hoisted(() => ({ listCards: vi.fn(), listActiveListings: vi.fn().mockResolvedValue([]), getPublicSellerProfile: vi.fn() }));
vi.mock('./data/firestore/repositories', () => ({ listCards, listActiveListings, getPublicSellerProfile }));

vi.mock('./features/auth/AuthStatus', () => ({
  AuthStatus: () => <div>auth status</div>,
}));
vi.mock('./features/profile/SellerProfilePage', () => ({
  SellerProfilePage: () => <div>profile page</div>,
}));
vi.mock('./features/listings/ListingPage', () => ({
  ListingPage: ({ id }: { id: string }) => <div>listing page {id}</div>,
}));

afterEach(() => {
  window.location.hash = '';
  cleanup();
});

describe('App routes', () => {
  it('renders the card master for the cards hash', () => {
    window.location.hash = '#/cards';

    render(<App />);

    expect(screen.getByRole('heading', { name: '卡牌資料庫' })).toBeTruthy();
  });

  it('uses development cards and shows the selected card summary', async () => {
    window.location.hash = '#/cards';
    const user = (await import('@testing-library/user-event')).default.setup();

    render(<App />);

    const option = await screen.findByRole('button', { name: '諸伏景光 · SEC' });
    await user.click(option);

    expect(developmentCards.some((card) => card.id === '0005')).toBe(true);
    expect(listCards).not.toHaveBeenCalled();
    expect(screen.getByText('0005')).toBeTruthy();
    expect(screen.getAllByText('SEC').length).toBeGreaterThan(0);
  });

  it('preserves marketplace and profile routes', () => {
    window.location.hash = '';
    const marketplace = render(<App />);
    expect(screen.getByRole('heading', { name: '搜尋正在販售的柯南 TCG 卡牌' })).toBeTruthy();
    marketplace.unmount();

    window.location.hash = '#/profile';
    render(<App />);
    expect(screen.getByText('profile page')).toBeTruthy();

    window.location.hash = '#/unknown';
    const unknown = render(<App />);
    expect(screen.getByRole('heading', { name: '搜尋正在販售的柯南 TCG 卡牌' })).toBeTruthy();
    unknown.unmount();
  });

  it('renders a listing detail when the hash changes from the marketplace', () => {
    window.location.hash = '';
    render(<App />);
    window.location.hash = '#/listing/listing-1';
    fireEvent(window, new HashChangeEvent('hashchange'));

    expect(screen.getByText('listing page listing-1')).toBeTruthy();
  });

  it('narrows marketplace rarity and ID filters from the typed character name', async () => {
    listCards.mockResolvedValue([
      { id: '0338', characterName: '諸伏景光', rarities: ['R', 'CP'] },
      { id: '0590', characterName: '諸伏景光', rarities: ['R'] },
      { id: '1010', characterName: '諸伏高明', rarities: ['SR'] },
    ]);
    listActiveListings.mockResolvedValue([]);

    render(<App />);

    await waitFor(() => expect(listCards).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('角色或人名篩選'), { target: { value: '諸伏' } });
    expect(screen.getByRole('button', { name: '諸伏景光' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '諸伏高明' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '諸伏景光' }));
    expect((screen.getByLabelText('角色或人名篩選') as HTMLInputElement).value).toBe('諸伏景光');
    expect([...screen.getByLabelText('稀有度篩選').querySelectorAll('option')].map((option) => option.getAttribute('value'))).toEqual(['', 'CP', 'R']);

    fireEvent.change(screen.getByLabelText('稀有度篩選'), { target: { value: 'R' } });
    expect([...screen.getByLabelText('卡片 ID 篩選').querySelectorAll('option')].map((option) => option.getAttribute('value'))).toEqual(['', '0338', '0590']);
  });
});
