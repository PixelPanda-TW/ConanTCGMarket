// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
vi.mock('./features/notifications/NotificationSettingsPage', () => ({
  NotificationSettingsPage: () => <h1>我的訂閱</h1>,
}));

afterEach(() => {
  window.location.hash = '';
  cleanup();
});

describe('App routes', () => {
  it('renders Marketplace for the retired cards hash', () => {
    window.location.hash = '#/cards';

    render(<App />);

    expect(screen.getByRole('heading', { name: 'marketplace page' })).toBeTruthy();
    expect(window.location.hash).not.toBe('#/cards');
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

  it('renders the subscription management page for #/notifications', () => {
    window.location.hash = '#/notifications';

    render(<App />);

    expect(screen.getByRole('heading', { name: '我的訂閱' })).toBeTruthy();
  });

});
