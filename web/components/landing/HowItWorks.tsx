import { Wallet, CircleDollarSign, ArrowUpDown, BarChart3 } from 'lucide-react';

const steps = [
  {
    number: '01',
    icon: Wallet,
    title: 'Connect Wallet',
    description: 'Link your Freighter wallet to start.',
  },
  {
    number: '02',
    icon: CircleDollarSign,
    title: 'Deposit USDC',
    description: 'Add collateral to the secure Vault.',
  },
  {
    number: '03',
    icon: ArrowUpDown,
    title: 'Open Position',
    description: 'Long or Short with up to 10x leverage.',
  },
  {
    number: '04',
    icon: BarChart3,
    title: 'Manage & Earn',
    description: 'Track PnL in real-time or earn NOE yields.',
  },
];

export function HowItWorks() {
  return (
    <section className="py-20 px-6 border-t border-white/5">
      <div className="max-w-7xl mx-auto">
        {/* Section Header */}
        <div className="text-center mb-16">
          <h2 className="font-heading text-4xl md:text-5xl font-bold text-white">
            How It Works
          </h2>
        </div>

        {/* Steps Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <div
                key={step.number}
                className="relative p-6 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-colors overflow-hidden group"
              >
                {/* Step Number with Line */}
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-[#00e6b8] font-mono text-sm font-medium -translate-y-4">
                    {step.number}
                  </span>
                  <div className="flex-1 flex items-center">
                    <div className="flex-1 h-px bg-[#00e6b8]/30 -translate-y-5" />
                  </div>
                </div>

                {/* Icon */}
                <div className="w-12 h-12 rounded-xl border border-[#00e6b8]/30 flex items-center justify-center mb-6 group-hover:border-[#00e6b8]/50 transition-colors">
                  <Icon className="w-5 h-5 text-[#00e6b8]" />
                </div>

                {/* Content */}
                <h3 className="font-heading text-lg font-semibold text-white mb-2">
                  {step.title}
                </h3>
                <p className="text-gray-500 text-sm">
                  {step.description}
                </p>

                {/* Background Number */}
                <div className="absolute top-4 right-4 font-heading text-[6rem] font-bold text-white/[0.02] leading-none pointer-events-none select-none">
                  {step.number}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
