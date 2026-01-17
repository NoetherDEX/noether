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
        <div className="flex items-center justify-between mb-3">
          {label && (
            <span className="text-sm font-medium text-neutral-400">{label}</span>
          )}
          {showValue && (
            <span className={cn(
              'text-sm font-semibold transition-colors',
              value >= 5 ? 'text-amber-400' : 'text-white'
            )}>
              {formatValue(value)}
            </span>
          )}
        </div>
      )}

      <div className="relative">
        {/* Track background */}
        <div className="absolute inset-0 h-2 top-1/2 -translate-y-1/2 bg-white/10 rounded-full" />

        {/* Track fill */}
        <div
          className={cn(
            'absolute h-2 top-1/2 -translate-y-1/2 rounded-full transition-all',
            value >= 7 ? 'bg-amber-500' : value >= 5 ? 'bg-amber-400/80' : 'bg-white'
          )}
          style={{ width: `${percentage}%` }}
        />

        {/* Input */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={handleChange}
          onMouseDown={() => setIsDragging(true)}
          onMouseUp={() => setIsDragging(false)}
          className={cn(
            'relative w-full h-6 appearance-none bg-transparent cursor-pointer z-10',
            '[&::-webkit-slider-thumb]:appearance-none',
            '[&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5',
            '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white',
            '[&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:cursor-grab',
            '[&::-webkit-slider-thumb]:transition-transform',
            isDragging && '[&::-webkit-slider-thumb]:scale-110 [&::-webkit-slider-thumb]:cursor-grabbing',
            '[&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5',
            '[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white',
            '[&::-moz-range-thumb]:border-none [&::-moz-range-thumb]:cursor-grab'
          )}
        />
      </div>

      {/* Marks */}
      {marks && (
        <div className="flex justify-between mt-2 px-1">
          {marks.map((mark) => (
            <button
              key={mark}
              onClick={() => onChange(mark)}
              className={cn(
                'text-xs transition-colors',
                value === mark ? 'text-white' : 'text-neutral-600 hover:text-neutral-400'
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
