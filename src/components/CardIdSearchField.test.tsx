// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CardIdSearchField } from './CardIdSearchField';

describe('CardIdSearchField', () => {
  afterEach(() => cleanup());

  it('normalizes prefixed IDs while exposing a character-capable text input', () => {
    const onChange = vi.fn();

    render(<CardIdSearchField value="P001" onChange={onChange} />);

    const input = screen.getByLabelText('搜尋卡片 ID');
    expect(input.getAttribute('type')).toBe('text');
    expect(input.getAttribute('inputmode')).toBeNull();
    expect(input.getAttribute('maxlength')).toBe('4');
    expect(input.getAttribute('autocapitalize')).toBe('characters');
    expect(input.getAttribute('spellcheck')).toBe('false');
    expect((input as HTMLInputElement).value).toBe('P001');

    fireEvent.change(input, { target: { value: 'p00' } });
    expect(onChange).toHaveBeenLastCalledWith('P00');
  });

  it('connects a visible error to the search input', () => {
    render(
      <CardIdSearchField
        value="05a"
        onChange={vi.fn()}
        error="卡片 ID 請輸入 4 位數字，或 P 加 3 位數字。"
      />,
    );

    const input = screen.getByLabelText('搜尋卡片 ID');
    const error = screen.getByRole('alert');
    expect(error.textContent).toBe('卡片 ID 請輸入 4 位數字，或 P 加 3 位數字。');
    expect(input.getAttribute('aria-describedby')).toBe(error.id);
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });
});
