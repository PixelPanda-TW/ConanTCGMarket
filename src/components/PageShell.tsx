import type { ReactNode } from 'react';
import { BackToMarketplaceLink } from './BackToMarketplaceLink';

type PageWidth = 'form' | 'wide-form' | 'marketplace' | 'listing';

interface PageShellProps {
  children: ReactNode;
  width?: PageWidth;
  backToMarketplace?: boolean;
}

export function PageShell({ children, width = 'form', backToMarketplace = false }: PageShellProps) {
  return (
    <main className={`app-shell page-shell page-shell--${width}`}>
      <div className="page-shell__content">
        {backToMarketplace && <BackToMarketplaceLink />}
        {children}
      </div>
      <footer className="site-footer">
        <span>致謝與致敬路奇亞</span>{' '}
        <a href="https://rugiacreation.com/conan/search" target="_blank" rel="noreferrer">rugiacreation.com</a>
      </footer>
    </main>
  );
}
