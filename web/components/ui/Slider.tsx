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
        <div className="absolute inset-0 h-3 top-1/2 -translate-y-1/2 bg-neutral-800/80 rounded-full border border-white/5" />

        {/* Track fill - gradient based on leverage risk */}
        <div
          className="absolute h-3 top-1/2 -translate-y-1/2 rounded-full transition-all"
          style={{
            width: `${percentage}%`,
            background: value >= 7
              ? 'linear-gradient(90deg, #22c55e 0%, #eab308 50%, #ef4444 100%)'
              : value >= 5
              ? 'linear-gradient(90deg, #22c55e 0%, #eab308 100%)'
              : 'linear-gradient(90deg, #22c55e 0%, #4ade80 100%)'
          }}
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
          onTouchStart={() => setIsDragging(true)}
          onTouchEnd={() => setIsDragging(false)}
          className={cn(
            'relative w-full h-8 appearance-none bg-transparent cursor-pointer z-10',
            // Webkit (Chrome, Safari, Edge) - larger knob
            '[&::-webkit-slider-thumb]:appearance-none',
            '[&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:h-6',
            '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white',
            '[&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(255,255,255,0.3)]',
            '[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white/20',
            '[&::-webkit-slider-thumb]:cursor-grab',
            '[&::-webkit-slider-thumb]:transition-all [&::-webkit-slider-thumb]:duration-150',
            '[&::-webkit-slider-thumb]:hover:scale-110 [&::-webkit-slider-thumb]:hover:shadow-[0_0_15px_rgba(255,255,255,0.5)]',
            isDragging && '[&::-webkit-slider-thumb]:scale-125 [&::-webkit-slider-thumb]:cursor-grabbing [&::-webkit-slider-thumb]:shadow-[0_0_20px_rgba(255,255,255,0.6)]',
            // Mozilla (Firefox) - larger knob
            '[&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:h-6',
            '[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white',
            '[&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white/20',
            '[&::-moz-range-thumb]:shadow-[0_0_10px_rgba(255,255,255,0.3)]',
            '[&::-moz-range-thumb]:cursor-grab'
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
