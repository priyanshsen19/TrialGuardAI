import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex whitespace-nowrap items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide', {
  variants: {
    variant: {
      default: 'border-border bg-muted text-foreground',
      pass: 'border-pass/40 bg-pass/15 text-pass',
      fail: 'border-fail/40 bg-fail/15 text-fail',
      warn: 'border-warn/40 bg-warn/15 text-warn',
      info: 'border-info/40 bg-info/15 text-info',
      muted: 'border-border bg-transparent text-muted-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
