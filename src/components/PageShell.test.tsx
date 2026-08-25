// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PageShell } from './PageShell';

afterEach(cleanup);

describe('PageShell', () => {
  it('renders the marketplace return link before child content', () => {
    render(<PageShell backToMarketplace><h1>刊登商品</h1></PageShell>);

    const backLink = screen.getByRole('link', { name: '← 返回市集' });
    const heading = screen.getByRole('heading', { name: '刊登商品' });
    expect(backLink.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('applies the wide form variant', () => {
    const { container } = render(<PageShell width="wide-form">內容</PageShell>);
    expect(container.querySelector('.page-shell--wide-form')).toBeTruthy();
  });

  it('credits Rugia Creation in a footer that opens the source site safely', () => {
    render(<PageShell>內容</PageShell>);

    const creditLink = screen.getByRole('link', { name: '致謝與致敬路基亞' });
    expect(creditLink.getAttribute('href')).toBe('https://rugiacreation.com');
    expect(creditLink.getAttribute('target')).toBe('_blank');
    expect(creditLink.getAttribute('rel')).toBe('noreferrer');
  });
});
