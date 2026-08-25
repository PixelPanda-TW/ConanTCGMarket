// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CardMetadataSelector } from './CardMetadataSelector';

const cards = [
  { id: '0338', characterName: '諸伏景光', rarities: ['R', 'CP'] },
  { id: '0590', characterName: '諸伏景光', rarities: ['R'] },
  { id: '1010', characterName: '諸伏高明', rarities: ['SR'] },
];

afterEach(() => cleanup());

describe('CardMetadataSelector', () => {
  it('uses native datalist candidates and clears dependent values when the character changes', () => {
    const onChange = vi.fn();
    const { container } = render(<CardMetadataSelector cards={cards} value={{ characterName: '諸伏', rarity: 'SR', cardId: '1010' }} onChange={onChange} requireCardId />);

    const input = screen.getByLabelText('角色／人名');
    expect(input.getAttribute('list')).toBe('card-metadata-character-options');
    expect([...container.querySelectorAll('datalist option')].map((option) => option.getAttribute('value'))).toEqual(['諸伏景光', '諸伏高明']);
    expect(screen.queryByRole('button', { name: '諸伏景光' })).toBeNull();

    fireEvent.change(input, { target: { value: '諸伏景光' } });

    expect(onChange).toHaveBeenCalledWith({ characterName: '諸伏景光', rarity: '', cardId: '' });
  });

  it('shows the optional marketplace ID placeholder', () => {
    render(<CardMetadataSelector cards={cards} value={{ characterName: '諸伏景光', rarity: 'R', cardId: '' }} onChange={vi.fn()} requireCardId={false} />);

    expect(screen.getByRole('option', { name: '全部卡片 ID' })).toBeTruthy();
  });
});
