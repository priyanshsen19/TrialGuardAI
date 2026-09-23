'use client';

import { AlertTriangle, Loader2 } from 'lucide-react';
import * as React from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { downloadFile } from '@/lib/api';

/** Export button with a pending state and a visible error (never fails silently). */
export function DownloadButton({ path, filename, open = false, icon, children, ...props }: Omit<ButtonProps, 'onClick'> & { path: string; filename: string; open?: boolean; icon: React.ReactNode }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <span className="relative inline-flex flex-col items-end">
      <Button
        {...props}
        disabled={busy || props.disabled}
        aria-busy={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await downloadFile(path, filename, open);
          } catch (e) {
            setError((e as Error).message || 'Export failed');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <Loader2 className="animate-spin" /> : icon} {children}
      </Button>
      {error && (
        <span role="alert" className="absolute right-0 top-full z-20 mt-1 flex w-72 items-start gap-1.5 rounded-md border border-fail/40 bg-panel px-2 py-1.5 text-[11px] text-fail shadow-lg">
          <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
          <span>{error}</span>
        </span>
      )}
    </span>
  );
}
