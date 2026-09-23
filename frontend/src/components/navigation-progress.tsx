'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import * as React from 'react';

/**
 * Thin top progress bar that appears the instant an internal link is clicked
 * and disappears when the new route has rendered — immediate feedback even
 * when the server or API is slow.
 */
function Bar() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [active, setActive] = React.useState(false);

  React.useEffect(() => setActive(false), [pathname, search]);

  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a');
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      setActive(true);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  // Safety net: never leave the bar stuck (e.g. navigation cancelled).
  React.useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => setActive(false), 15_000);
    return () => clearTimeout(t);
  }, [active]);

  if (!active) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden bg-primary/20" role="progressbar" aria-label="Loading page">
      <div className="h-full w-1/3 animate-nav-progress bg-primary shadow-[0_0_8px_hsl(var(--primary))]" />
    </div>
  );
}

export function NavigationProgress() {
  return (
    <React.Suspense fallback={null}>
      <Bar />
    </React.Suspense>
  );
}
