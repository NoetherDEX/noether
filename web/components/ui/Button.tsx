'use client';

import { forwardRef, ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'success' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', isLoading, disabled, children, ...props }, ref) => {
    // Focus indication comes from the global gold :focus-visible outline (globals.css)
    const baseStyles = 'inline-flex items-center justify-center whitespace-nowrap font-medium transition-colors rounded-md disabled:opacity-50 disabled:cursor-not-allowed';

    const variants = {
      // Brand gold is the one accent: CTAs only. Near-black text (white on gold is 1.98:1).
      primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
      secondary: 'bg-surface-2 text-foreground border border-border-strong hover:bg-surface-3',
      ghost: 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-surface-2',
      // Near-black text on the direction fills — matches MobileTradeBar (9.2:1 vs 2.28:1 white-on-green)
      success: 'bg-long text-background hover:bg-long/90',
      danger: 'bg-short text-background hover:bg-short/90',
    };

    const sizes = {
      sm: 'h-8 px-3 text-xs',
      md: 'h-9 px-4 text-sm',
      lg: 'h-11 px-6 text-sm',
    };

    return (
      <button
        ref={ref}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading ? (
          <>
            <svg
              className="animate-spin -ml-1 mr-2 h-4 w-4"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            Loading…
          </>
        ) : (
          children
        )}
      </button>
    );
  }
);

Button.displayName = 'Button';

export { Button };
