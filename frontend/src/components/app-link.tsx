'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import * as React from 'react';
import { api } from '@/lib/api';

type LinkProps = React.ComponentProps<typeof Link>;

/**
 * next/link + data prefetch on hover/focus: the detail page's query is warmed
 * with the same query key it uses, so the page usually renders with data the
 * moment it opens.
 */
function prefetchesFor(href: string): Array<{ key: unknown[]; path: string }> {
  const m = /^\/(screenings|trials|audit|patients)\/([^/?#]+)$/.exec(href);
  if (!m) return [];
  const [, section, id] = m;
  if (section === 'screenings') return [{ key: ['screening', id], path: `/screenings/${id}` }];
  if (section === 'trials') return [{ key: ['trial', id], path: `/trials/${id}` }];
  if (section === 'patients') return [{ key: ['patient', id], path: `/patients/${id}` }];
  return [
    { key: ['audit', id], path: `/audit/${id}` },
    { key: ['screening', id], path: `/screenings/${id}` },
  ];
}

export const AppLink = React.forwardRef<HTMLAnchorElement, LinkProps>(function AppLink({ onMouseEnter, onFocus, href, ...rest }, ref) {
  const qc = useQueryClient();
  const warm = React.useCallback(() => {
    const h = typeof href === 'string' ? href : (href.pathname ?? '');
    for (const p of prefetchesFor(h)) {
      void qc.prefetchQuery({ queryKey: p.key, queryFn: () => api.get(p.path), staleTime: 10_000 });
    }
  }, [href, qc]);
  return (
    <Link
      ref={ref}
      href={href}
      onMouseEnter={(e) => {
        warm();
        onMouseEnter?.(e);
      }}
      onFocus={(e) => {
        warm();
        onFocus?.(e);
      }}
      {...rest}
    />
  );
});
