// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CardIdSearchField } from './CardIdSearchField';

describe('CardIdSearchField', () => {
  afterEach(() => cleanup());

  it('preserves leading zeroes while exposing the numeric text-input affordance', () => {
    const onChange = vi.fn();

    render(<CardIdSearchField value="0501" onChange={onChange} />);

    const input = screen.getByLabelText('搜尋卡片 ID');
    expect(input.getAttribute('type')).toBe('text');
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.getAttribute('maxlength')).toBe('4');
    expect((input as HTMLInputElement).value).toBe('0501');

    fireEvent.change(input, { target: { value: '0007' } });
    expect(onChange).toHaveBeenLastCalledWith('0007');
  });

  it('connects a visible error to the search input', () => {
    render(
      <CardIdSearchField
        value="05a"
        onChange={vi.fn()}
        error="卡片 ID 只能輸入最多 4 位數字。"
      />,
    );

    const input = screen.getByLabelText('搜尋卡片 ID');
    const error = screen.getByRole('alert');
    expect(error.textContent).toBe('卡片 ID 只能輸入最多 4 位數字。');
    expect(input.getAttribute('aria-describedby')).toBe(error.id);
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });
});
