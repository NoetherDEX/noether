'use client';

import { useId, useState, ReactNode, KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';

interface TooltipProps {
  /** The trigger — typically an Info icon or a term needing explanation. */
  children: ReactNode;
  /** One short sentence. Announced to screen readers via aria-describedby. */
  content: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
  /**
   * The wrapper is keyboard-focusable by default so non-interactive triggers
   * (icons, plain text) work for keyboard users. Set false when wrapping an
   * already-focusable element (button/link) to avoid a double tab stop.
   */
  focusable?: boolean;
}

/**
 * Accessible tooltip: shows on hover AND keyboard focus (touch users reach it
 * by focusing the trigger), role="tooltip" + aria-describedby while open,
 * Escape dismisses (WAI-ARIA tooltip pattern). Dark panel per brand.
 */
export function Tooltip({
  children,
  content,
  position = 'top',
  className,
  focusable = true,
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const tooltipId = useId();

  const positions = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  const arrows = {
    top: 'top-full left-1/2 -translate-x-1/2 border-t-neutral-800',
    bottom: 'bottom-full left-1/2 -translate-x-1/2 border-b-neutral-800',
    left: 'left-full top-1/2 -translate-y-1/2 border-l-neutral-800',
    right: 'right-full top-1/2 -translate-y-1/2 border-r-neutral-800',
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key === 'Escape' && isVisible) {
      event.stopPropagation();
      setIsVisible(false);
    }
  };

  return (
    <span
      className={cn('relative inline-block', className)}
      tabIndex={focusable ? 0 : undefined}
      aria-describedby={isVisible ? tooltipId : undefined}
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
      onFocus={() => setIsVisible(true)}
      onBlur={() => setIsVisible(false)}
      onKeyDown={handleKeyDown}
    >
      {children}

      {isVisible && (
        <span
          id={tooltipId}
          role="tooltip"
          className={cn(
            'absolute z-50 block px-3 py-1.5 text-xs text-white bg-neutral-800 rounded-lg',
            'w-max max-w-[16rem] whitespace-normal text-left pointer-events-none',
            'animate-in fade-in-0 zoom-in-95 duration-200',
            positions[position]
          )}
        >
          {content}
          <span
            className={cn(
              'absolute block w-0 h-0 border-4 border-transparent',
              arrows[position]
            )}
          />
        </span>
      )}
    </span>
  );
}
