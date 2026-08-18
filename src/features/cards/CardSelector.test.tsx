// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Card } from '../../domain/models';
import { CardSelector } from './CardSelector';

const cards: readonly Card[] = [
  { id: 'BT-001', nameZh: '江戶川柯南', nameJa: '江戸川コナン', rarity: 'R' },
  { id: 'BT-003', nameZh: '諸伏景光', nameJa: '諸伏景光', rarity: 'R' },
  { id: 'BT-005', nameZh: '諸伏景光', nameJa: '諸伏景光', rarity: 'SEC' },
];

afterEach(() => {
  cleanup();
});

describe('CardSelector', () => {
  it('filters visible options from the query without treating typed text as a selected card', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<CardSelector cards={cards} value={null} onChange={onChange} />);

    await user.type(screen.getByRole('textbox', { name: '搜尋卡牌' }), '諸伏');

    expect(screen.getByRole('button', { name: '諸伏景光 · R' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '諸伏景光 · SEC' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '江戶川柯南 · R' })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('returns the complete card object when an option is selected', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<CardSelector cards={cards} value={null} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: '諸伏景光 · SEC' }));

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith({
      id: 'BT-005',
      nameZh: '諸伏景光',
      nameJa: '諸伏景光',
      rarity: 'SEC',
    });
  });

  it('clears the selected card with an explicit clear action', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<CardSelector cards={cards} value={cards[1]} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: '清除已選擇的卡牌' }));

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('keeps card selection as a one-way action instead of a toggle button', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<CardSelector cards={cards} value={cards[1]} onChange={onChange} />);

    expect(screen.getByRole('button', { name: '諸伏景光 · R' }).getAttribute('aria-pressed')).toBeNull();
    await user.click(screen.getByRole('button', { name: '諸伏景光 · R' }));
    expect(onChange).toHaveBeenCalledWith(cards[1]);
  });
});
