'use client';

import { cn } from '@/lib/utils';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  size?: 'sm' | 'md';
  className?: string;
}

export function Badge({ children, variant = 'default', size = 'sm', className }: BadgeProps) {
  const variants = {
    default: 'bg-surface-2 text-muted-foreground border-border-strong',
    success: 'bg-long/10 text-long border-long/20',
    warning: 'bg-primary/10 text-primary border-primary/20',
    danger: 'bg-short/10 text-short border-short/20',
    info: 'bg-accent/10 text-accent border-accent/20',
  };

  const sizes = {
    sm: 'px-1.5 py-0.5 text-[11px]',
    md: 'px-2 py-0.5 text-xs',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center font-medium rounded-sm border',
        variants[variant],
        sizes[size],
        className
      )}
    >
      {children}
    </span>
  );
}
