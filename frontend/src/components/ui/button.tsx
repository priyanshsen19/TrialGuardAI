import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        secondary: 'bg-muted text-foreground hover:bg-muted/80 border border-border',
        outline: 'border border-border bg-transparent hover:bg-panel-2',
        ghost: 'hover:bg-panel-2 text-muted-foreground hover:text-foreground',
        success: 'bg-pass/90 text-white hover:bg-pass',
        destructive: 'bg-fail/90 text-white hover:bg-fail',
        warning: 'bg-warn/90 text-black hover:bg-warn',
      },
      size: { default: 'h-9 px-3.5', sm: 'h-8 px-2.5 text-xs', lg: 'h-10 px-5', icon: 'h-8 w-8' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
));
Button.displayName = 'Button';
