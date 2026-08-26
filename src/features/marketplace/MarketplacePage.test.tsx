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
  { key: 'character_0338', cardId: '0338', cardType: 'character', cardName: '諸伏景光', rarities: ['R', 'CP'] },
  { key: 'character_0590', cardId: '0590', cardType: 'character', cardName: '諸伏景光', rarities: ['R'] },
  { key: 'character_0501', cardId: '0501', cardType: 'character', cardName: '諸伏高明', rarities: ['D'] },
  { key: 'event_1100', cardId: '1100', cardType: 'event', cardName: '追跡開始', rarities: ['C'] },
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
    expect(styles).toContain('@media (max-width: 375px)');
  });

  it('shows only active listings and independent ID search before a type is selected', async () => {
    render(
      <MarketplacePage
        loadListings={async () => [activeListing, { ...activeListing, id: 'sold-out', status: 'sold_out' }]}
        loadCards={async () => cards}
        loadSeller={async () => seller}
      />,
    );

    expect(await screen.findByRole('heading', { name: '諸伏景光' })).toBeTruthy();
    expect(screen.queryByText('sold-out')).toBeNull();

    const cardIdInput = screen.getByLabelText('搜尋卡片 ID');
    expect((cardIdInput as HTMLInputElement).value).toBe('');
    expect((cardIdInput as HTMLInputElement).disabled).toBe(false);
    expect(screen.queryByLabelText('卡片 ID')).toBeNull();
    expect((screen.getByLabelText('卡片名稱') as HTMLInputElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('卡片類型'), { target: { value: 'character' } });
    fireEvent.change(screen.getByLabelText('卡片名稱'), { target: { value: '諸伏' } });
    expect([...document.querySelectorAll('datalist option')].map((option) => option.getAttribute('value'))).toEqual(['諸伏景光', '諸伏高明']);
    fireEvent.change(screen.getByLabelText('卡片名稱'), { target: { value: '諸伏景光' } });
    expect((screen.getByLabelText('卡片名稱') as HTMLInputElement).value).toBe('諸伏景光');
    expect([...screen.getByLabelText('稀有度').querySelectorAll('option')].map((option) => option.value)).toEqual(['', 'CP', 'R']);

    fireEvent.change(screen.getByLabelText('稀有度'), { target: { value: 'R' } });
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
    fireEvent.change(screen.getByLabelText('卡片類型'), { target: { value: 'character' } });
    fireEvent.change(screen.getByLabelText('卡片名稱'), { target: { value: '諸伏景光' } });
    expect(screen.getByRole('button', { name: '訂閱諸伏景光' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('卡片名稱'), { target: { value: '諸伏' } });
    expect(screen.queryByRole('button', { name: /訂閱諸伏/ })).toBeNull();
  });

  it('filters all cards of a type by rarity when the card name is incomplete or unrecognized', async () => {
    const eventR = {
      ...activeListing,
      id: 'event-r',
      cardId: '1101',
      cardType: 'event' as const,
      cardName: '另一張事件卡',
      characterName: undefined,
      rarity: 'R',
    };
    const eventC = {
      ...activeListing,
      id: 'event-c',
      cardId: '1100',
      cardType: 'event' as const,
      cardName: '追跡開始',
      characterName: undefined,
      rarity: 'C',
    };
    const eventCards: Card[] = [
      { key: 'event_1100', cardId: '1100', cardType: 'event', cardName: '追跡開始', rarities: ['C'] },
      { key: 'event_1101', cardId: '1101', cardType: 'event', cardName: '另一張事件卡', rarities: ['R'] },
    ];
    render(<MarketplacePage loadListings={async () => [activeListing, eventC, eventR]} loadCards={async () => eventCards} loadSeller={async () => seller} />);

    await screen.findByRole('heading', { name: '追跡開始' });
    fireEvent.change(screen.getByLabelText('卡片類型'), { target: { value: 'event' } });

    const rarity = screen.getByLabelText('稀有度') as HTMLSelectElement;
    expect(rarity.disabled).toBe(false);
    expect([...rarity.options].map((option) => option.value)).toEqual(['', 'C', 'R']);

    fireEvent.change(rarity, { target: { value: 'R' } });
    expect(screen.getByRole('heading', { name: '另一張事件卡' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '追跡開始' })).toBeNull();

    fireEvent.change(screen.getByLabelText('卡片名稱'), { target: { value: '不存在' } });
    fireEvent.change(screen.getByLabelText('稀有度'), { target: { value: 'R' } });
    expect(screen.getByRole('heading', { name: '另一張事件卡' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '追跡開始' })).toBeNull();
  });

  it('narrows a Marketplace rarity to the exact known card name', async () => {
    const eventR = {
      ...activeListing,
      id: 'event-r',
      cardId: '1101',
      cardType: 'event' as const,
      cardName: '另一張事件卡',
      characterName: undefined,
      rarity: 'R',
    };
    const eventC = {
      ...activeListing,
      id: 'event-c',
      cardId: '1100',
      cardType: 'event' as const,
      cardName: '追跡開始',
      characterName: undefined,
      rarity: 'R',
    };
    const eventCards: Card[] = [
      { key: 'event_1100', cardId: '1100', cardType: 'event', cardName: '追跡開始', rarities: ['C', 'R'] },
      { key: 'event_1101', cardId: '1101', cardType: 'event', cardName: '另一張事件卡', rarities: ['R'] },
    ];
    render(<MarketplacePage loadListings={async () => [eventC, eventR]} loadCards={async () => eventCards} loadSeller={async () => seller} />);

    await screen.findByRole('heading', { name: '追跡開始' });
    fireEvent.change(screen.getByLabelText('卡片類型'), { target: { value: 'event' } });
    fireEvent.change(screen.getByLabelText('卡片名稱'), { target: { value: '追跡開始' } });

    expect([...screen.getByLabelText('稀有度').querySelectorAll('option')].map((option) => option.value)).toEqual(['', 'C', 'R']);
    fireEvent.change(screen.getByLabelText('稀有度'), { target: { value: 'R' } });

    expect(screen.getByRole('heading', { name: '追跡開始' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '另一張事件卡' })).toBeNull();
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
    fireEvent.change(screen.getByLabelText('卡片類型'), { target: { value: 'character' } });
    fireEvent.change(screen.getByLabelText('卡片名稱'), { target: { value: '諸伏高明' } });
    fireEvent.change(screen.getByLabelText('稀有度'), { target: { value: 'D' } });

    const panel = screen.getByRole('region', { name: '角色通知' });
    expect(panel).toBeTruthy();
    expect(screen.getByRole('button', { name: '訂閱諸伏高明' })).toBeTruthy();
  });

  it('composes an event type, ID prefix, and myship filter without another Firestore fetch', async () => {
    const loadListings = vi.fn(async () => [
      activeListing,
      {
        ...activeListing,
        id: 'event-listing',
        cardId: '1100',
        cardType: 'event' as const,
        cardName: '追跡開始',
        characterName: undefined,
        rarity: 'C',
        supportsMyShip: true,
      },
    ]);
    const loadCards = vi.fn(async () => cards);

    render(<MarketplacePage loadListings={loadListings} loadCards={loadCards} loadSeller={async () => seller} />);

    await screen.findByRole('heading', { name: '諸伏景光' });
    fireEvent.change(screen.getByLabelText('卡片類型'), { target: { value: 'event' } });
    fireEvent.change(screen.getByLabelText('搜尋卡片 ID'), { target: { value: '11' } });
    fireEvent.click(screen.getByLabelText('賣貨便'));

    expect(await screen.findByRole('heading', { name: '追跡開始' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '諸伏景光' })).toBeNull();
    expect(loadListings).toHaveBeenCalledTimes(1);
    expect(loadCards).toHaveBeenCalledTimes(1);
  });

  it('shows ambiguity instead of choosing the first Firestore Card sharing a visible ID', async () => {
    const legacyListing = {
      ...activeListing,
      id: 'legacy-shared-id',
      cardId: '0501',
      characterName: undefined,
      rarity: undefined,
    };
    const sharedCards: Card[] = [
      { key: 'card_character', cardId: '0501', cardType: 'character', cardName: '諸伏高明', rarities: ['D'] },
      { key: 'card_event', cardId: '0501', cardType: 'event', cardName: '事件 0501', rarities: ['C'] },
    ];

    render(
      <MarketplacePage
        loadListings={async () => [legacyListing]}
        loadCards={async () => sharedCards}
        loadSeller={async () => seller}
      />,
    );

    expect(await screen.findByRole('heading', { name: '卡片資料不明確' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '諸伏高明' })).toBeNull();
    expect(screen.queryByRole('heading', { name: '事件 0501' })).toBeNull();
  });

  it('shows the field error and no results for an invalid ID without fetching again', async () => {
    const loadListings = vi.fn(async () => [activeListing]);
    const loadCards = vi.fn(async () => cards);
    render(<MarketplacePage loadListings={loadListings} loadCards={loadCards} loadSeller={async () => seller} />);

    await screen.findByRole('heading', { name: '諸伏景光' });
    fireEvent.change(screen.getByLabelText('搜尋卡片 ID'), { target: { value: '05a' } });

    expect(screen.getByRole('alert').textContent).toBe('卡片 ID 請輸入 4 位數字，或 P 加 3 位數字。');
    expect(screen.getByText('目前沒有符合條件的商品。')).toBeTruthy();
    expect(loadListings).toHaveBeenCalledTimes(1);
    expect(loadCards).toHaveBeenCalledTimes(1);
  });
});
