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
      {backToMarketplace && <BackToMarketplaceLink />}
      {children}
    </main>
  );
}
