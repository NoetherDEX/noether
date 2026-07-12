'use client';

import { cn } from '@/lib/utils';

interface SkeletonProps {
  className?: string;
  variant?: 'text' | 'circular' | 'rectangular';
}

export function Skeleton({ className, variant = 'rectangular' }: SkeletonProps) {
  const variants = {
    text: 'h-4 rounded-sm',
    circular: 'rounded-full',
    rectangular: 'rounded-md',
  };

  return (
    <div
      className={cn(
        'animate-pulse bg-surface-3',
        variants[variant],
        className
      )}
    />
  );
}

// Common skeleton patterns
export function SkeletonCard() {
  return (
    <div className="p-4 rounded-lg border border-border bg-surface">
      <Skeleton className="h-5 w-1/3 mb-4" />
      <Skeleton className="h-4 w-full mb-2" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

export function SkeletonTable({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-3 py-2.5 rounded-md bg-surface">
          <Skeleton className="h-8 w-8" variant="circular" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}
