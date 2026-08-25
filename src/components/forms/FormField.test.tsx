// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CheckboxField, FieldError, FieldLabel } from './FormField';

afterEach(() => cleanup());

describe('form primitives', () => {
  it('renders a required label and an announced error', () => {
    render(<><FieldLabel required>角色／人名</FieldLabel><FieldError id="name-error" message="請填寫角色／人名。" /></>);

    expect(screen.getByText('角色／人名（必填）')).toBeTruthy();
    expect(screen.getByRole('alert').id).toBe('name-error');
  });

  it('renders no error node without a message', () => {
    render(<FieldError />);

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders an accessible controlled checkbox', () => {
    render(<CheckboxField label="包手" ariaLabel="包手" checked onChange={() => undefined} />);

    expect((screen.getByRole('checkbox', { name: '包手' }) as HTMLInputElement).checked).toBe(true);
  });
});
