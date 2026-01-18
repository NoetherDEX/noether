'use client';

import { forwardRef, InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  suffix?: string;
  prefix?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, suffix, prefix, type = 'text', ...props }, ref) => {
    return (
      <div className="w-full">
        {label && (
          <label className="block text-sm font-medium text-neutral-400 mb-2">
            {label}
          </label>
        )}
        <div className="relative">
          {prefix && (
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <span className="text-neutral-500">{prefix}</span>
            </div>
          )}
          <input
            ref={ref}
            type={type}
            className={cn(
              'w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-neutral-600',
              'focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/20',
              'transition-all duration-200',
              // Remove browser default number input spinners
              '[&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
              '[&::-webkit-outer-spin-button]:m-0 [&::-webkit-inner-spin-button]:m-0',
              '[appearance:textfield]', // Firefox
              prefix && 'pl-10',
              suffix && 'pr-16',
              error && 'border-red-500/50 focus:border-red-500',
              className
            )}
            {...props}
          />
          {suffix && (
            <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none">
              <span className="text-neutral-500 text-sm">{suffix}</span>
            </div>
          )}
        </div>
        {error && (
          <p className="mt-1 text-sm text-red-400">{error}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

export { Input };
