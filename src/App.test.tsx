// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listCards } from './data/firestore/repositories';
import App from './App';

vi.mock('./data/firestore/repositories', () => ({
  listCards: vi.fn(),
}));

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
  NotificationSettingsPage: () => <h1>通知設定</h1>,
}));

afterEach(() => {
  window.location.hash = '';
  vi.mocked(listCards).mockReset();
  cleanup();
});

beforeEach(() => {
  vi.mocked(listCards).mockResolvedValue([]);
});

describe('App routes', () => {
  it('renders the card master for the cards hash', () => {
    window.location.hash = '#/cards';

    render(<App />);

    expect(screen.getByRole('heading', { name: '卡牌資料庫' })).toBeTruthy();
  });

  it('loads public Card Master records through the repository by default', async () => {
    window.location.hash = '#/cards';
    const user = (await import('@testing-library/user-event')).default.setup();
    vi.mocked(listCards).mockResolvedValue([
      { key: 'partner_1167', cardId: '1167', cardType: 'partner', cardName: '江戶川柯南', rarities: ['P'] },
    ]);

    render(<App />);

    const option = await screen.findByRole('button', { name: 'Partner 卡（拍檔卡） · 江戶川柯南 · ID 1167 · P' });
    await user.click(option);

    expect(listCards).toHaveBeenCalledOnce();
    expect(screen.getByText('1167')).toBeTruthy();
    expect(screen.getByText('Partner 卡（拍檔卡）')).toBeTruthy();
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

  it('renders notification settings for #/notifications', () => {
    window.location.hash = '#/notifications';

    render(<App />);

    expect(screen.getByRole('heading', { name: '通知設定' })).toBeTruthy();
  });

});
