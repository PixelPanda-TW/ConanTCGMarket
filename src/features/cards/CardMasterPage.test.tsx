// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { Card } from '../../domain/models';
import { CardMasterPage } from './CardMasterPage';

const cards: Card[] = [
  { id: 'BT-003', nameZh: '諸伏景光', nameJa: '諸伏景光', rarity: 'R' },
];

afterEach(() => cleanup());

describe('CardMasterPage', () => {
  it('shows loading and then the selected card summary from an injected loader', async () => {
    let resolveCards!: (value: Card[]) => void;
    const loading = new Promise<Card[]>((resolve) => {
      resolveCards = resolve;
    });
    const user = userEvent.setup();

    render(<CardMasterPage loadCards={() => loading} />);
    expect(screen.getByText('載入卡牌資料中')).toBeTruthy();

    resolveCards(cards);
    expect(await screen.findByRole('button', { name: '諸伏景光 · R' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '諸伏景光 · R' }));
    expect(screen.getByText('卡號')).toBeTruthy();
    expect(screen.getByText('BT-003')).toBeTruthy();
  });

  it('shows a loader error state', async () => {
    render(<CardMasterPage loadCards={() => Promise.reject(new Error('卡牌資料讀取失敗'))} />);

    expect((await screen.findByRole('alert')).textContent).toContain('卡牌資料讀取失敗');
  });
});
