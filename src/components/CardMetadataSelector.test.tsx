// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Card } from '../domain/models';
import { CardMetadataSelector, type CardMetadataSelection } from './CardMetadataSelector';

const styles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

const cards: readonly Card[] = [
  { key: 'card_a', cardId: '0501', cardType: 'character', cardName: '諸伏高明', rarities: ['D'] },
  { key: 'card_b', cardId: '0501', cardType: 'event', cardName: '事件 0501', rarities: ['D'] },
  { key: 'card_c', cardId: 'P001', cardType: 'partner', cardName: '江戶川柯南', rarities: ['P'] },
  { key: 'card_d', cardId: '1200', cardType: 'case', cardName: '緋色の真相', rarities: ['C'] },
];

afterEach(() => cleanup());

function SelectorHarness({
  showCardId = true,
  mode = 'sell',
}: {
  showCardId?: boolean;
  mode?: 'sell' | 'marketplace';
}) {
  const [value, setValue] = useState<CardMetadataSelection>({
    cardType: 'character', cardName: '', rarity: '', cardId: '',
  });

  return <CardMetadataSelector cards={cards} value={value} onChange={setValue} showCardId={showCardId} mode={mode} required />;
}

function LegacySelectorHarness() {
  const [value, setValue] = useState<CardMetadataSelection>({
    characterName: '諸伏高明', rarity: 'D', cardId: '0501',
  });

  return <CardMetadataSelector cards={cards} value={value} onChange={setValue} requireCardId={false} />;
}

describe('CardMetadataSelector', () => {
  it('uses a native datalist for card names filtered by the chosen type', () => {
    const { container } = render(<SelectorHarness />);

    fireEvent.change(screen.getByLabelText('卡片類型'), { target: { value: 'event' } });
    fireEvent.change(screen.getByLabelText('卡片名稱'), { target: { value: '事件' } });

    const input = screen.getByLabelText('卡片名稱');
    expect(input.getAttribute('list')).toBe('card-metadata-name-options');
    expect([...container.querySelectorAll('datalist option')].map((option) => option.getAttribute('value'))).toEqual(['事件 0501']);
  });

  it('clears dependent metadata after each upstream change', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <CardMetadataSelector
        cards={cards}
        value={{ cardType: 'event', cardName: '事件 0501', rarity: 'D', cardId: '0501' }}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('卡片類型'), { target: { value: 'case' } });
    expect(onChange).toHaveBeenLastCalledWith({ cardType: 'case', cardName: '', rarity: '', cardId: '' });

    rerender(
      <CardMetadataSelector
        cards={cards}
        value={{ cardType: 'case', cardName: '緋色の真相', rarity: 'C', cardId: '1200' }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText('卡片名稱'), { target: { value: '手打名稱' } });
    expect(onChange).toHaveBeenLastCalledWith({ cardType: 'case', cardName: '手打名稱', rarity: '', cardId: '' });

    rerender(
      <CardMetadataSelector
        cards={cards}
        value={{ cardType: 'case', cardName: '緋色の真相', rarity: 'C', cardId: '1200' }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText('稀有度'), { target: { value: 'C' } });
    expect(onChange).toHaveBeenLastCalledWith({ cardType: 'case', cardName: '緋色の真相', rarity: 'C', cardId: '' });
  });

  it('omits the dependent card ID select when requested', () => {
    render(<SelectorHarness showCardId={false} />);

    expect(screen.queryByLabelText('卡片 ID')).toBeNull();
  });

  it('enables Marketplace rarity filtering across a card type before a known name is selected', () => {
    render(<SelectorHarness showCardId={false} mode="marketplace" />);

    fireEvent.change(screen.getByLabelText('卡片類型'), { target: { value: 'character' } });
    fireEvent.change(screen.getByLabelText('卡片名稱'), { target: { value: '諸伏' } });

    const rarity = screen.getByLabelText('稀有度') as HTMLSelectElement;
    expect(rarity.disabled).toBe(false);
    expect([...rarity.options].map((option) => option.value)).toEqual(['', 'D']);
  });

  it('keeps Sell rarity disabled until the typed name is an exact known card', () => {
    render(<SelectorHarness />);

    fireEvent.change(screen.getByLabelText('卡片名稱'), { target: { value: '諸伏' } });
    expect((screen.getByLabelText('稀有度') as HTMLSelectElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('卡片名稱'), { target: { value: '諸伏高明' } });
    expect((screen.getByLabelText('稀有度') as HTMLSelectElement).disabled).toBe(false);
  });

  it('keeps the legacy character-only name field enabled for real user editing', async () => {
    const user = userEvent.setup();
    render(<LegacySelectorHarness />);

    const input = screen.getByLabelText('角色／人名') as HTMLInputElement;
    expect(input.disabled).toBe(false);
    await user.clear(input);
    await user.type(input, '江戶川');

    expect(input.value).toBe('江戶川');
    expect(screen.getByLabelText('卡片 ID').tagName).toBe('INPUT');
  });

  it('accepts a normalized visible card ID through a mobile-safe text input and datalist', () => {
    const onChange = vi.fn();
    const { container } = render(
      <CardMetadataSelector
        cards={cards}
        value={{ cardType: 'partner', cardName: '江戶川柯南', rarity: 'P', cardId: '' }}
        onChange={onChange}
      />,
    );

    const cardId = screen.getByLabelText('卡片 ID') as HTMLInputElement;
    expect(cardId.tagName).toBe('INPUT');
    expect(cardId.getAttribute('list')).toBe('card-metadata-id-options');
    expect(cardId.maxLength).toBe(4);
    expect(cardId.getAttribute('autocapitalize')).toBe('characters');
    expect(cardId.getAttribute('spellcheck')).toBe('false');
    expect(cardId.getAttribute('inputmode')).toBeNull();
    const options = [...container.querySelectorAll('#card-metadata-id-options option')];
    expect(options.map((option) => option.getAttribute('value'))).toEqual(['P001']);
    expect(options.map((option) => option.textContent).join('')).not.toContain('card_c');

    fireEvent.change(cardId, { target: { value: 'p001' } });
    expect(onChange).toHaveBeenCalledWith({
      cardType: 'partner', cardName: '江戶川柯南', rarity: 'P', cardId: 'P001',
    });
  });

  it('keeps card ID entry disabled until rarity is selected', () => {
    render(<SelectorHarness />);

    expect((screen.getByLabelText('卡片 ID') as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('卡片名稱'), { target: { value: '諸伏高明' } });
    fireEvent.change(screen.getByLabelText('稀有度'), { target: { value: 'D' } });
    expect((screen.getByLabelText('卡片 ID') as HTMLInputElement).disabled).toBe(false);
  });

  it('keeps the sell ID input keyboard-visible, touch-sized, and mobile-width safe', () => {
    const style = document.createElement('style');
    style.textContent = styles;
    document.head.append(style);

    try {
      render(
        <form className="profile-form" style={{ width: '375px' }}>
          <CardMetadataSelector
            cards={cards}
            value={{ cardType: 'partner', cardName: '江戶川柯南', rarity: 'P', cardId: '' }}
            onChange={vi.fn()}
          />
        </form>,
      );

      const cardId = screen.getByLabelText('卡片 ID') as HTMLInputElement;
      cardId.focus();

      expect(cardId.matches(':focus-visible')).toBe(true);
      const cardIdStyle = getComputedStyle(cardId);
      expect(cardIdStyle.outline.toLowerCase()).toContain('2px');
      expect(cardIdStyle.outline.toLowerCase()).toContain('solid');
      expect(cardIdStyle.outlineOffset).toBe('2px');
      expect(cardIdStyle.minHeight).toBe('44px');
      expect(cardIdStyle.width).toBe('100%');
      expect(cardIdStyle.boxSizing).toBe('border-box');
      expect(getComputedStyle(cardId.closest('label') as HTMLLabelElement).minWidth).toBe('0px');
    } finally {
      style.remove();
    }
  });

});
