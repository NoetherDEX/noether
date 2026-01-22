export function StatsStrip() {
  const stats = [
    { value: '$2.4M+', label: 'TOTAL VOLUME' },
    { value: '$847K', label: 'OPEN INTEREST' },
    { value: '1,240', label: 'TOTAL TRADERS' },
  ];

  return (
    <section className="py-16 border-y border-white/5">
      <div className="max-w-5xl mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-4">
          {stats.map((stat, index) => (
            <div
              key={stat.label}
              className="text-center relative"
            >
              {/* Separator for desktop */}
              {index > 0 && (
                <div className="hidden md:block absolute left-0 top-1/2 -translate-y-1/2 w-px h-12 bg-white/10" />
              )}
              <div className="font-heading text-4xl md:text-5xl font-bold text-white mb-2 tracking-tight">
                {stat.value}
              </div>
              <div className="text-xs text-gray-500 tracking-[0.2em] uppercase">
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
