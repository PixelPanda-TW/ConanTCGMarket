// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Card } from '../../domain/models';
import { CardSelector } from './CardSelector';

const cards: readonly Card[] = [
  { id: '0001', cardType: 'character', cardName: '江戶川柯南', rarities: ['R', 'CP'] },
  { id: '0003', cardType: 'character', cardName: '諸伏景光', rarities: ['R'] },
  { id: '0005', cardType: 'character', cardName: '諸伏景光', rarities: ['SEC'] },
  { id: '1167', cardType: 'partner', cardName: '江戶川柯南', rarities: ['P'] },
];

afterEach(() => {
  cleanup();
});

describe('CardSelector', () => {
  it('displays all normalized rarities for each card', () => {
    render(<CardSelector cards={cards} value={null} onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: '角色卡 · 江戶川柯南 · ID 0001 · R、CP' })).toBeTruthy();
  });

  it('labels same-name cards with their type and ID', () => {
    render(<CardSelector cards={cards} value={null} onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: '角色卡 · 江戶川柯南 · ID 0001 · R、CP' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Partner 卡（拍檔卡） · 江戶川柯南 · ID 1167 · P' })).toBeTruthy();
  });

  it('filters visible options from the query without treating typed text as a selected card', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<CardSelector cards={cards} value={null} onChange={onChange} />);

    await user.type(screen.getByRole('textbox', { name: '搜尋卡牌' }), '諸伏');

    expect(screen.getByRole('button', { name: '角色卡 · 諸伏景光 · ID 0003 · R' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '角色卡 · 諸伏景光 · ID 0005 · SEC' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '角色卡 · 江戶川柯南 · ID 0001 · R、CP' })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('returns the complete card object when an option is selected', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<CardSelector cards={cards} value={null} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: '角色卡 · 諸伏景光 · ID 0005 · SEC' }));

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith({
      id: '0005',
      cardType: 'character',
      cardName: '諸伏景光',
      rarities: ['SEC'],
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

    expect(screen.getByRole('button', { name: '角色卡 · 諸伏景光 · ID 0003 · R' }).getAttribute('aria-pressed')).toBeNull();
    await user.click(screen.getByRole('button', { name: '角色卡 · 諸伏景光 · ID 0003 · R' }));
    expect(onChange).toHaveBeenCalledWith(cards[1]);
  });
});
