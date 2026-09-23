import { Skeleton } from '@/components/ui/misc';

/** Shown instantly on navigation while the next page (and its data) loads. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <Skeleton className="mb-2 h-3 w-24" />
      <Skeleton className="mb-2 h-6 w-64" />
      <Skeleton className="mb-6 h-4 w-[28rem] max-w-full" />
      <div className="grid gap-4 lg:grid-cols-4">
        <Skeleton className="h-40 lg:col-span-2" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
      <Skeleton className="mt-4 h-10 w-full" />
      <div className="mt-4 space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    </div>
  );
}
