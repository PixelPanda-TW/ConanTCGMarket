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
vi.mock('./features/reports/ReportListingPage', () => ({
  ReportListingPage: ({ id }: { id: string }) => <div>report listing {id}</div>,
}));
vi.mock('./features/notifications/NotificationSettingsPage', () => ({
  NotificationSettingsPage: () => <h1>我的訂閱</h1>,
}));
vi.mock('./features/admin/CardMasterAdminPage', () => ({
  CardMasterAdminPage: () => <h1>卡片資料管理</h1>,
}));
vi.mock('./features/admin/ModerationQueuePage', () => ({
  ModerationQueuePage: () => <h1>moderation queue</h1>,
}));
vi.mock('./features/admin/ModerationCasePage', () => ({
  ModerationCasePage: ({ id }: { id: string }) => <h1>moderation case {id}</h1>,
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

  it('renders the dedicated report route before the generic Listing route', () => {
    window.location.hash = '#/listing/listing-1/report';
    render(<App />);
    expect(screen.getByText('report listing listing-1')).toBeTruthy();
    expect(screen.queryByText(/listing page/u)).toBeNull();
  });

  it('renders the protected Card Master console for #/admin/cards', () => {
    window.location.hash = '#/admin/cards';
    render(<App />);
    expect(screen.getByRole('heading', { name: '卡片資料管理' })).toBeTruthy();
  });

  it('renders the moderation queue and exact case before generic routes', () => {
    window.location.hash = '#/admin/moderation';
    const queue = render(<App />);
    expect(screen.getByRole('heading', { name: 'moderation queue' })).toBeTruthy();
    queue.unmount();

    window.location.hash = '#/admin/moderation/report_ABC-123';
    render(<App />);
    expect(screen.getByRole('heading', { name: 'moderation case report_ABC-123' })).toBeTruthy();
    expect(screen.queryByText(/listing page/u)).toBeNull();
  });

  it('does not dispatch malformed moderation case hashes', () => {
    for (const hash of [
      '#/admin/moderation/report%2Fchild',
      '#/admin/moderation/report-1/extra',
    ]) {
      window.location.hash = hash;
      const view = render(<App />);
      expect(screen.getByRole('heading', { name: 'marketplace page' })).toBeTruthy();
      view.unmount();
    }
  });

});
