// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ListingForm } from './ListingForm';

const defaultProps = {
  price: '500',
  quantity: '1',
  files: [] as File[],
  hasSleeve: false,
  sleeveFee: '',
  supportsMyShip: false,
  myShipFee: '',
  note: '',
  onPriceChange: vi.fn(),
  onQuantityChange: vi.fn(),
  onFilesChange: vi.fn(),
  onHasSleeveChange: vi.fn(),
  onSleeveFeeChange: vi.fn(),
  onSupportsMyShipChange: vi.fn(),
  onMyShipFeeChange: vi.fn(),
  onNoteChange: vi.fn(),
  submitLabel: '建立刊登',
};

afterEach(cleanup);

describe('ListingForm', () => {
  it('shows a required material fee only after sleeve is selected', () => {
    const onHasSleeveChange = vi.fn();
    const firstForm = render(<ListingForm {...defaultProps} onHasSleeveChange={onHasSleeveChange} />);

    expect(screen.queryByLabelText('包材費')).toBeNull();
    fireEvent.click(screen.getByLabelText('包手'));
    expect(onHasSleeveChange).toHaveBeenCalledWith(true);

    firstForm.unmount();
    render(<ListingForm {...defaultProps} hasSleeve />);
    expect(screen.getByLabelText('包材費')).toBeTruthy();
    expect(screen.getByText('包材費（必填）')).toBeTruthy();
  });

  it('keeps note optional and exposes transaction guidance', () => {
    render(<ListingForm {...defaultProps} />);

    expect(screen.getByText('備註（選填）')).toBeTruthy();
    expect(screen.getByLabelText('其他交易需求提醒')).toBeTruthy();
  });

  it('can omit inventory controls for trusted edit workflows', () => {
    render(<ListingForm {...defaultProps} showQuantity={false} submitLabel="儲存變更" />);

    expect(screen.queryByLabelText('數量')).toBeNull();
    expect(screen.getByLabelText('價格')).toBeTruthy();
  });
});
