// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { developmentCards } from './data/cards/developmentCards';
import App from './App';

vi.mock('./features/marketplace/MarketplacePage', () => ({
  MarketplacePage: () => <h1>marketplace page</h1>,
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
    expect(screen.getByText('0005')).toBeTruthy();
    expect(screen.getAllByText('SEC').length).toBeGreaterThan(0);
  });

  it('preserves marketplace and profile routes', () => {
    window.location.hash = '';
    const marketplace = render(<App />);
    expect(screen.getByRole('heading', { name: 'marketplace page' })).toBeTruthy();
    marketplace.unmount();

    window.location.hash = '#/profile';
    render(<App />);
    expect(screen.getByText('profile page')).toBeTruthy();

    window.location.hash = '#/unknown';
    const unknown = render(<App />);
    expect(screen.getByRole('heading', { name: 'marketplace page' })).toBeTruthy();
    unknown.unmount();
  });

  it('renders a listing detail when the hash changes from the marketplace', () => {
    window.location.hash = '';
    render(<App />);
    window.location.hash = '#/listing/listing-1';
    fireEvent(window, new HashChangeEvent('hashchange'));

    expect(screen.getByText('listing page listing-1')).toBeTruthy();
  });

});
