// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BackToMarketplaceLink } from './BackToMarketplaceLink';

describe('BackToMarketplaceLink', () => {
  it('renders the shared top-left marketplace return link', () => {
    render(<BackToMarketplaceLink />);

    const link = screen.getByRole('link', { name: '← 返回市集' });
    expect(link.getAttribute('href')).toBe('#');
    expect(link.classList.contains('back-link')).toBe(true);
    expect(link.classList.contains('page-back-link')).toBe(true);
  });
});
