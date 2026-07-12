'use client';

import { forwardRef, useId, InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  suffix?: string;
  prefix?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, suffix, prefix, type = 'text', id, ...props }, ref) => {
    const autoId = useId();
    const inputId = id ?? autoId;
    const errorId = `${inputId}-error`;

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="block text-xs font-medium text-muted-foreground mb-1.5">
            {label}
          </label>
        )}
        <div className="relative">
          {prefix && (
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <span className="text-faint text-sm">{prefix}</span>
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            type={type}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className={cn(
              'w-full bg-surface-2 border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-faint',
              'focus:outline-none focus:border-border-strong focus:ring-1 focus:ring-border-strong',
              'transition-colors',
              // Remove browser default number input spinners
              '[&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
              '[&::-webkit-outer-spin-button]:m-0 [&::-webkit-inner-spin-button]:m-0',
              '[appearance:textfield]', // Firefox
              prefix && 'pl-9',
              suffix && 'pr-14',
              error && 'border-short/50 focus:border-short',
              className
            )}
            {...props}
          />
          {suffix && (
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
              <span className="text-faint text-xs">{suffix}</span>
            </div>
          )}
        </div>
        {error && (
          <p id={errorId} className="mt-1 text-xs text-short">{error}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

export { Input };
