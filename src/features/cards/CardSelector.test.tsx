// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Card } from '../../domain/models';
import { CardSelector } from './CardSelector';

const cards: readonly Card[] = [
  { key: 'card_a', cardId: '0001', cardType: 'character', cardName: '江戶川柯南', rarities: ['R', 'CP'] },
  { key: 'card_b', cardId: '0003', cardType: 'character', cardName: '諸伏景光', rarities: ['R'] },
  { key: 'card_c', cardId: '0005', cardType: 'character', cardName: '諸伏景光', rarities: ['SEC'] },
  { key: 'card_d', cardId: '1167', cardType: 'partner', cardName: '江戶川柯南', rarities: ['P'] },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
      key: 'card_c',
      cardId: '0005',
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

  it('keeps cards with a shared visible ID independently clickable without duplicate React keys', async () => {
    const sharedIdCards: readonly Card[] = [
      { key: 'card_a', cardId: '0501', cardType: 'character', cardName: '諸伏高明', rarities: ['D'] },
      { key: 'card_b', cardId: '0501', cardType: 'event', cardName: '事件 0501', rarities: ['D'] },
    ];
    const onChange = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const user = userEvent.setup();

    render(<CardSelector cards={sharedIdCards} value={null} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: '角色卡 · 諸伏高明 · ID 0501 · D' }));
    await user.click(screen.getByRole('button', { name: '事件卡 · 事件 0501 · ID 0501 · D' }));

    expect(onChange).toHaveBeenNthCalledWith(1, sharedIdCards[0]);
    expect(onChange).toHaveBeenNthCalledWith(2, sharedIdCards[1]);
    expect(consoleError.mock.calls.some(([message]) => String(message).includes('same key'))).toBe(false);
  });
});
