'use client';

export function BrowserFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col w-full h-full">
      {/* Title bar */}
      <div className="flex items-center px-4 h-9 bg-[#1a1a1e] flex-shrink-0">
        <div className="flex items-center gap-[7px]">
          <span className="w-[11px] h-[11px] rounded-full bg-[#ff5f57]" />
          <span className="w-[11px] h-[11px] rounded-full bg-[#febc2e]" />
          <span className="w-[11px] h-[11px] rounded-full bg-[#28c840]" />
        </div>

        <div className="flex-1 flex justify-center -ml-[55px]">
          <div className="flex items-center gap-1.5 bg-[#0e0e11] rounded-md px-3 py-1">
            <svg width="10" height="12" viewBox="0 0 10 12" fill="none">
              <path
                d="M5 0C3.067 0 1.5 1.567 1.5 3.5V5H1a1 1 0 00-1 1v5a1 1 0 001 1h8a1 1 0 001-1V6a1 1 0 00-1-1h-.5V3.5C8.5 1.567 6.933 0 5 0zM3 3.5C3 2.395 3.895 1.5 5 1.5s2 .895 2 2V5H3V3.5z"
                fill="#888"
              />
            </svg>
            <span className="text-[11px] text-white/40 font-mono tracking-wide">
              noether.exchange
            </span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 relative min-h-0">{children}</div>
    </div>
  );
}
