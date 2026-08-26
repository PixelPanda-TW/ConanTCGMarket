// @vitest-environment jsdom

import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Card } from '../domain/models';
import { CardMetadataSelector, type CardMetadataSelection } from './CardMetadataSelector';

const cards: readonly Card[] = [
  { id: '1001', cardType: 'character', cardName: '江戶川柯南', rarities: ['R'] },
  { id: '1100', cardType: 'event', cardName: '追跡開始', rarities: ['C'] },
  { id: '1200', cardType: 'case', cardName: '緋色の真相', rarities: ['C'] },
  { id: '1167', cardType: 'partner', cardName: '江戶川柯南', rarities: ['P'] },
];

afterEach(() => cleanup());

function SelectorHarness({ showCardId = true }: { showCardId?: boolean }) {
  const [value, setValue] = useState<CardMetadataSelection>({
    cardType: 'character', cardName: '', rarity: '', cardId: '',
  });

  return <CardMetadataSelector cards={cards} value={value} onChange={setValue} showCardId={showCardId} required />;
}

describe('CardMetadataSelector', () => {
  it('uses a native datalist for card names filtered by the chosen type', () => {
    const { container } = render(<SelectorHarness />);

    fireEvent.change(screen.getByLabelText('卡片類型'), { target: { value: 'event' } });
    fireEvent.change(screen.getByLabelText('卡片名稱'), { target: { value: '追' } });

    const input = screen.getByLabelText('卡片名稱');
    expect(input.getAttribute('list')).toBe('card-metadata-name-options');
    expect([...container.querySelectorAll('datalist option')].map((option) => option.getAttribute('value'))).toEqual(['追跡開始']);
  });

  it('clears dependent metadata after each upstream change', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <CardMetadataSelector
        cards={cards}
        value={{ cardType: 'event', cardName: '追跡開始', rarity: 'C', cardId: '1100' }}
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

  it('adapts the legacy character-only selection without changing its callbacks', () => {
    const onChange = vi.fn();
    render(
      <CardMetadataSelector
        cards={cards}
        value={{ characterName: '江戶川柯南', rarity: 'R', cardId: '1001' } as never}
        onChange={onChange}
        requireCardId={false}
      />,
    );

    fireEvent.change(screen.getByLabelText('角色／人名'), { target: { value: '江戶川' } });

    expect(onChange).toHaveBeenLastCalledWith({ characterName: '江戶川', rarity: '', cardId: '' });
    expect(screen.getByRole('option', { name: '全部卡片 ID' })).toBeTruthy();
  });

});
