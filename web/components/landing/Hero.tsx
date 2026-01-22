import Link from 'next/link';

export function Hero() {
  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center px-6 pt-20">
      {/* Subtle background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-[#00e6b8]/5 rounded-full blur-[150px]" />
      </div>

      <div className="relative z-10 text-center max-w-5xl mx-auto">
        {/* Headline */}
        <h1 className="font-heading text-5xl md:text-7xl lg:text-8xl font-bold mb-8 leading-[1.1] tracking-tight">
          <span className="text-white block">PERPETUAL TRADING IN</span>
          <span className="bg-gradient-to-r from-[#00e6b8] to-[#00d4ff] bg-clip-text text-transparent">
            PERFECT SYMMETRY
          </span>
        </h1>

        {/* Sub-headline */}
        <p className="text-lg md:text-xl text-gray-400 mb-12 max-w-2xl mx-auto leading-relaxed">
          Trade with up to 10x leverage, zero price impact, and 5s finality on Stellar.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/trade"
            className="px-8 py-4 bg-[#00e6b8] hover:bg-[#00d4a8] text-[#051015] rounded-xl font-semibold text-lg transition-all duration-200"
          >
            Start Trading
          </Link>
          <Link
            href="#"
            className="px-8 py-4 text-gray-400 hover:text-white font-medium text-lg transition-colors"
          >
            Read Docs
          </Link>
        </div>
      </div>
    </section>
  );
}
