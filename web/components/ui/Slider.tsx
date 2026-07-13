'use client';

import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';

interface SliderProps {
  min?: number;
  max?: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  label?: string;
  showValue?: boolean;
  formatValue?: (value: number) => string;
  marks?: number[];
}

export function Slider({
  min = 1,
  max = 10,
  step = 1,
  value,
  onChange,
  label,
  showValue = true,
  formatValue = (v) => `${v}x`,
  marks,
}: SliderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const percentage = ((value - min) / (max - min)) * 100;

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(Number(e.target.value));
    },
    [onChange]
  );

  return (
    <div className="w-full">
      {(label || showValue) && (
        <div className="flex items-center justify-between mb-2">
          {label && (
            <span className="text-xs font-medium text-muted-foreground">{label}</span>
          )}
          {showValue && (
            <span className={cn(
              'text-sm font-mono tabular-nums transition-colors',
              value >= 5 ? 'text-primary' : 'text-foreground'
            )}>
              {formatValue(value)}
            </span>
          )}
        </div>
      )}

      <div className="relative">
        {/* Track background — thin hairline rail */}
        <div className="absolute inset-x-0 h-1 top-1/2 -translate-y-1/2 bg-surface-3 rounded-full" />

        {/* Track fill — flat brand accent, no risk rainbow */}
        <div
          className="absolute h-1 top-1/2 -translate-y-1/2 rounded-full bg-primary"
          style={{ width: `${percentage}%` }}
        />

        {/* Input */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={label}
          aria-valuetext={formatValue(value)}
          onChange={handleChange}
          onMouseDown={() => setIsDragging(true)}
          onMouseUp={() => setIsDragging(false)}
          onTouchStart={() => setIsDragging(true)}
          onTouchEnd={() => setIsDragging(false)}
          className={cn(
            'relative w-full h-8 appearance-none bg-transparent cursor-pointer z-10',
            // Webkit (Chrome, Safari, Edge)
            '[&::-webkit-slider-thumb]:appearance-none',
            '[&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5',
            '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground',
            '[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-background',
            '[&::-webkit-slider-thumb]:cursor-grab',
            '[&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:duration-150',
            '[&::-webkit-slider-thumb]:hover:scale-110',
            isDragging && '[&::-webkit-slider-thumb]:scale-110 [&::-webkit-slider-thumb]:cursor-grabbing',
            // Mozilla (Firefox)
            '[&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5',
            '[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-foreground',
            '[&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-background',
            '[&::-moz-range-thumb]:cursor-grab'
          )}
        />
      </div>

      {/* Marks */}
      {marks && (
        <div className="flex justify-between mt-1 px-1">
          {marks.map((mark) => (
            <button
              key={mark}
              type="button"
              onClick={() => onChange(mark)}
              className={cn(
                'text-[11px] font-mono tabular-nums py-1 transition-colors',
                value === mark ? 'text-foreground' : 'text-faint hover:text-muted-foreground'
              )}
            >
              {formatValue(mark)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
