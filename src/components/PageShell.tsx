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
        <a href="https://rugiacreation.com" target="_blank" rel="noreferrer">致謝與致敬路基亞</a>
      </footer>
    </main>
  );
}
