'use client';

import { X } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';

export function Dialog({ open, onClose, title, description, children, className }: { open: boolean; onClose: () => void; title: string; description?: string; children: React.ReactNode; className?: string }) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className={cn('max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-panel shadow-2xl scrollbar-thin', className)} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-border px-5 py-3.5">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-muted-foreground hover:bg-panel-2 hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
