// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Card, Listing, SellerProfile } from '../../domain/models';
import { MarketplacePage } from './MarketplacePage';

vi.mock('../auth/AuthStatus', () => ({
  AuthStatus: () => <div>auth status</div>,
}));

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({
    user: null,
    isLoading: false,
    error: null,
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));

const cards: Card[] = [
  { id: '0338', cardType: 'character', cardName: '諸伏景光', characterName: '諸伏景光', rarities: ['R', 'CP'] },
  { id: '0590', cardType: 'character', cardName: '諸伏景光', characterName: '諸伏景光', rarities: ['R'] },
  { id: '0501', cardType: 'character', cardName: '諸伏高明', characterName: '諸伏高明', rarities: ['D'] },
];

const activeListing: Listing = {
  id: 'listing-1',
  sellerId: 'seller-1',
  cardId: '0338',
  characterName: '諸伏景光',
  rarity: 'R',
  imageUrls: ['https://example.com/card.jpg'],
  listingPrice: 500,
  originalQuantity: 1,
  remainingQuantity: 1,
  hasSleeve: false,
  supportsMyShip: false,
  status: 'active',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const seller: SellerProfile = {
  uid: 'seller-1',
  displayName: '賣家 A',
  contactType: 'line',
  contactValue: 'seller-a',
  createdAt: new Date(),
  updatedAt: new Date(),
};

afterEach(() => {
  window.localStorage.clear();
  cleanup();
});

describe('MarketplacePage', () => {
  it('shows the welcome notice once per browser after acknowledgement', async () => {
    const props = {
      loadListings: async () => [activeListing],
      loadCards: async () => cards,
      loadSeller: async () => seller,
    };
    const firstVisit = render(<MarketplacePage {...props} />);

    const dialog = screen.getByRole('dialog', { name: '網站使用與安全提醒' });
    const rugiaLinks = within(dialog).getAllByRole('link', { name: 'rugiacreation.com' });
    expect(rugiaLinks).toHaveLength(2);
    expect(rugiaLinks.every((link) => link.getAttribute('href') === 'https://rugiacreation.com/conan/search')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '我知道了' }));
    expect(screen.queryByRole('dialog', { name: '網站使用與安全提醒' })).toBeNull();

    firstVisit.unmount();
    render(<MarketplacePage {...props} />);
    expect(screen.queryByRole('dialog', { name: '網站使用與安全提醒' })).toBeNull();
  });

  it('does not flatten the mobile metadata selector with display contents', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

    expect(styles).toContain('.filters .marketplace-card-metadata-selector { flex: 1 0 100%; min-width: 0; }');
    expect(styles).not.toContain('.marketplace-card-metadata-selector { display: contents; }');
  });

  it('shows only active listings and narrows card metadata filters from a selected character', async () => {
    render(
      <MarketplacePage
        loadListings={async () => [activeListing, { ...activeListing, id: 'sold-out', status: 'sold_out' }]}
        loadCards={async () => cards}
        loadSeller={async () => seller}
      />,
    );

    expect(await screen.findByRole('heading', { name: '諸伏景光' })).toBeTruthy();
    expect(screen.queryByText('sold-out')).toBeNull();

    fireEvent.change(screen.getByLabelText('角色／人名'), { target: { value: '諸伏' } });
    expect([...document.querySelectorAll('datalist option')].map((option) => option.getAttribute('value'))).toEqual(['諸伏景光', '諸伏高明']);
    fireEvent.change(screen.getByLabelText('角色／人名'), { target: { value: '諸伏景光' } });
    expect((screen.getByLabelText('角色／人名') as HTMLInputElement).value).toBe('諸伏景光');
    expect([...screen.getByLabelText('稀有度').querySelectorAll('option')].map((option) => option.value)).toEqual(['', 'CP', 'R']);

    fireEvent.change(screen.getByLabelText('稀有度'), { target: { value: 'R' } });
    expect([...screen.getByLabelText('卡片 ID').querySelectorAll('option')].map((option) => option.value)).toEqual(['', '0338', '0590']);
  });

  it('shows subscription only for an exact known character, not invalid free text', async () => {
    render(
      <MarketplacePage
        loadListings={async () => [activeListing]}
        loadCards={async () => cards}
        loadSeller={async () => seller}
      />,
    );

    await screen.findByRole('heading', { name: '諸伏景光' });
    fireEvent.change(screen.getByLabelText('角色／人名'), { target: { value: '諸伏景光' } });
    expect(screen.getByRole('button', { name: '訂閱諸伏景光' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('角色／人名'), { target: { value: '諸伏' } });
    expect(screen.queryByRole('button', { name: /訂閱諸伏/ })).toBeNull();
  });

  it('shows a dedicated character notification panel after selecting 諸伏高明／D／0501', async () => {
    render(
      <MarketplacePage
        loadListings={async () => [activeListing]}
        loadCards={async () => cards}
        loadSeller={async () => seller}
      />,
    );

    await screen.findByRole('heading', { name: '諸伏景光' });
    fireEvent.change(screen.getByLabelText('角色／人名'), { target: { value: '諸伏高明' } });
    fireEvent.change(screen.getByLabelText('稀有度'), { target: { value: 'D' } });
    fireEvent.change(screen.getByLabelText('卡片 ID'), { target: { value: '0501' } });

    const panel = screen.getByRole('region', { name: '角色通知' });
    expect(panel).toBeTruthy();
    expect(screen.getByRole('button', { name: '訂閱諸伏高明' })).toBeTruthy();
  });
});
