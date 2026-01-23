import { TrendingUp, CircleDollarSign } from 'lucide-react';

export function UserSegments() {
  return (
    <section className="py-20 px-6">
      <div className="max-w-6xl mx-auto">
        {/* Section Header */}
        <div className="text-center mb-16">
          <h2 className="font-heading text-4xl md:text-5xl font-bold text-white mb-4">
            The Symmetry of Markets
          </h2>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto">
            A balanced ecosystem where Trader performance drives Liquidity Provider yield.
          </p>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* For Traders */}
          <div className="p-8 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-[#00e6b8]/30 transition-colors">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 rounded-xl bg-[#00e6b8]/10 flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-[#00e6b8]" />
              </div>
              <h3 className="font-heading text-xl font-semibold text-white">
                For Traders
              </h3>
            </div>
            <ul className="space-y-4">
              {[
                'Up to 10x leverage on long and short positions.',
                'Perpetual contracts with no expiry dates.',
                'Real-time PnL tracking.',
                'Zero price impact via Oracle feeds.',
              ].map((item, index) => (
                <li key={index} className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#00e6b8] flex-shrink-0 mt-2" />
                  <span className="text-gray-400 text-sm">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* For Liquidity Providers */}
          <div className="p-8 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-[#00d4ff]/30 transition-colors">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 rounded-xl bg-[#00d4ff]/10 flex items-center justify-center">
                <CircleDollarSign className="w-6 h-6 text-[#00d4ff]" />
              </div>
              <h3 className="font-heading text-xl font-semibold text-white">
                For Liquidity Providers
              </h3>
            </div>
            <ul className="space-y-4">
              {[
                'Earn yield from trading fees and trader losses.',
                'Mint NOE tokens representing your pool share.',
                'Proportional and fair distribution.',
                'Withdraw liquidity anytime.',
              ].map((item, index) => (
                <li key={index} className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#00d4ff] flex-shrink-0 mt-2" />
                  <span className="text-gray-400 text-sm">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
