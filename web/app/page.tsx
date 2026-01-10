export default function Home() {
  return (
    <main className="min-h-screen bg-[#09090b] text-white overflow-x-hidden">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#09090b]/90 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center font-bold text-black">
              N
            </div>
            <span className="text-xl font-semibold">Noether</span>
          </div>
          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-neutral-500 hover:text-white transition-colors">Features</a>
            <a href="#how-it-works" className="text-neutral-500 hover:text-white transition-colors">How It Works</a>
            <a href="#roadmap" className="text-neutral-500 hover:text-white transition-colors">Roadmap</a>
            <a href="#faq" className="text-neutral-500 hover:text-white transition-colors">FAQ</a>
          </div>
          <button className="px-5 py-2.5 bg-white text-black hover:bg-neutral-200 rounded-lg font-medium transition-all">
            Launch App
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative min-h-screen flex flex-col items-center justify-center px-6 pt-20">
        {/* Background Effects */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-emerald-500/5 rounded-full blur-[120px]" />
        </div>

        {/* Subtle grid */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:72px_72px]" />

        <div className="relative z-10 text-center max-w-4xl mx-auto">
          <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold mb-6 leading-[1.1] tracking-tight">
            Trade Perpetuals
            <br />
            <span className="text-neutral-500">Without Limits</span>
          </h1>

          <p className="text-lg md:text-xl text-neutral-400 mb-12 max-w-2xl mx-auto leading-relaxed">
            The first decentralized perpetual exchange on Stellar. Trade with up to 10x leverage, zero price impact, and near-instant settlement.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-20">
            <button className="group px-8 py-4 bg-white text-black hover:bg-neutral-100 rounded-xl font-medium text-lg transition-all">
              Start Trading
              <span className="inline-block ml-2 transition-transform group-hover:translate-x-1">→</span>
            </button>
            <button className="px-8 py-4 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-xl font-medium text-lg transition-all">
              Read Documentation
            </button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 max-w-3xl mx-auto">
            <StatCard value="$0" label="Total Volume" />
            <StatCard value="0" label="Total Trades" />
            <StatCard value="10x" label="Max Leverage" />
            <StatCard value="<5s" label="Settlement" />
          </div>
        </div>

      </section>

      {/* Partners Section */}
      <section className="py-16 border-y border-white/5">
        <div className="max-w-7xl mx-auto px-6">
          <p className="text-center text-neutral-600 text-sm uppercase tracking-wider mb-8">Powered by</p>
          <div className="flex flex-wrap items-center justify-center gap-12">
            <span className="text-xl font-medium text-neutral-600">Stellar</span>
            <span className="text-xl font-medium text-neutral-600">Soroban</span>
            <span className="text-xl font-medium text-neutral-600">Band Protocol</span>
            <span className="text-xl font-medium text-neutral-600">DIA Oracle</span>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-4 tracking-tight">
              Why Noether?
            </h2>
            <p className="text-lg text-neutral-500 max-w-xl mx-auto">
              Built for traders who demand performance, security, and transparency.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            <FeatureCard
              title="Non-Custodial"
              description="Your keys, your crypto. Trade directly from your wallet with full control over your funds."
            />
            <FeatureCard
              title="Lightning Fast"
              description="Near-instant trade execution with ~5 second finality. No more waiting."
            />
            <FeatureCard
              title="Low Fees"
              description="Fraction of a cent per transaction. Keep more of your profits."
            />
            <FeatureCard
              title="Zero Price Impact"
              description="Trade any size without moving the market. Oracle-based pricing ensures fair execution."
            />
            <FeatureCard
              title="Dual Oracles"
              description="Band Protocol and DIA integration for maximum price reliability and security."
            />
            <FeatureCard
              title="Fully On-Chain"
              description="Every trade, every position, every settlement recorded on-chain."
            />
          </div>
        </div>
      </section>

      {/* For Traders & LPs Section */}
      <section className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-6">
            {/* For Traders */}
            <div className="p-8 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-colors">
              <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center text-xl mb-6">
                ↗
              </div>
              <h3 className="text-2xl font-semibold mb-3">For Traders</h3>
              <p className="text-neutral-500 mb-6">
                Access powerful trading tools designed for both beginners and professionals.
              </p>
              <ul className="space-y-3">
                <ListItem text="Up to 10x leverage on long and short positions" />
                <ListItem text="Perpetual contracts with no expiry dates" />
                <ListItem text="Real-time PnL tracking" />
                <ListItem text="Market orders with instant execution" />
              </ul>
            </div>

            {/* For LPs */}
            <div className="p-8 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-colors">
              <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center text-xl mb-6">
                ◈
              </div>
              <h3 className="text-2xl font-semibold mb-3">For Liquidity Providers</h3>
              <p className="text-neutral-500 mb-6">
                Earn yield by providing liquidity to the protocol&apos;s GLP pool.
              </p>
              <ul className="space-y-3">
                <ListItem text="Earn from trading fees and trader losses" />
                <ListItem text="GLP tokens represent your pool share" />
                <ListItem text="Proportional and fair distribution" />
                <ListItem text="Withdraw your liquidity anytime" />
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="py-24 px-6 bg-white/[0.01]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-4 tracking-tight">
              How It Works
            </h2>
            <p className="text-lg text-neutral-500 max-w-xl mx-auto">
              Start trading in minutes with our simple process.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            <StepCard
              number="01"
              title="Connect Wallet"
              description="Connect your Freighter wallet to access the trading interface."
            />
            <StepCard
              number="02"
              title="Deposit Collateral"
              description="Deposit USDC as collateral to open leveraged positions."
            />
            <StepCard
              number="03"
              title="Open Position"
              description="Choose your asset, direction, and leverage up to 10x."
            />
            <StepCard
              number="04"
              title="Manage & Close"
              description="Monitor your PnL in real-time and close when ready."
            />
          </div>
        </div>
      </section>

      {/* Architecture Section */}
      <section className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-4 tracking-tight">
              Architecture
            </h2>
            <p className="text-lg text-neutral-500 max-w-xl mx-auto">
              Built with security and scalability using Soroban smart contracts.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5 text-center">
              <div className="text-2xl mb-4">⚙</div>
              <h3 className="text-lg font-medium mb-2">Market Contract</h3>
              <p className="text-sm text-neutral-500">Core trading engine for positions and PnL calculations.</p>
            </div>
            <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5 text-center">
              <div className="text-2xl mb-4">◇</div>
              <h3 className="text-lg font-medium mb-2">Vault Contract</h3>
              <p className="text-sm text-neutral-500">GLP-style liquidity pool for deposits and settlements.</p>
            </div>
            <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5 text-center">
              <div className="text-2xl mb-4">◎</div>
              <h3 className="text-lg font-medium mb-2">Oracle Adapter</h3>
              <p className="text-sm text-neutral-500">Aggregates prices from Band and DIA with safety checks.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Roadmap Section */}
      <section id="roadmap" className="py-24 px-6 bg-white/[0.01]">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-4 tracking-tight">
              Roadmap
            </h2>
            <p className="text-lg text-neutral-500 max-w-xl mx-auto">
              Building the future of decentralized derivatives on Stellar.
            </p>
          </div>

          <div className="space-y-4">
            <RoadmapItem
              phase="Phase 1"
              title="Foundation"
              items={["Monorepo architecture", "Core smart contracts", "Shared type system"]}
              status="completed"
            />
            <RoadmapItem
              phase="Phase 2"
              title="Core Protocol"
              items={["Market contract", "Vault contract", "Oracle integration"]}
              status="completed"
            />
            <RoadmapItem
              phase="Phase 3"
              title="Operations"
              items={["Testnet deployment", "Keeper bot", "Trading interface"]}
              status="in-progress"
            />
            <RoadmapItem
              phase="Phase 4"
              title="Enhancement"
              items={["More trading pairs", "Limit orders", "Mobile UI"]}
              status="upcoming"
            />
            <RoadmapItem
              phase="Phase 5"
              title="Production"
              items={["Security audits", "Mainnet", "Governance"]}
              status="upcoming"
            />
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="py-24 px-6">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-4 tracking-tight">
              FAQ
            </h2>
          </div>

          <div className="space-y-3">
            <FAQItem
              question="What is Noether?"
              answer="Noether is a decentralized perpetual exchange built on Stellar using Soroban smart contracts. It allows traders to open leveraged long and short positions on crypto assets, while liquidity providers earn yield by supplying capital."
            />
            <FAQItem
              question="Why is it named Noether?"
              answer="Named after Emmy Noether, the brilliant mathematician whose theorem on symmetry and conservation laws revolutionized physics. Our protocol aims to bring the same elegance to decentralized derivatives trading."
            />
            <FAQItem
              question="What assets can I trade?"
              answer="Currently, you can trade XLM/USD perpetuals. More trading pairs will be added in future updates."
            />
            <FAQItem
              question="How does the GLP model work?"
              answer="Liquidity providers deposit USDC and receive GLP tokens representing their share of the pool. LPs earn when traders lose and pay when traders profit, plus they receive trading fees."
            />
            <FAQItem
              question="Is Noether audited?"
              answer="Noether is currently on Stellar Testnet and has not yet been audited. Comprehensive security audits are planned before mainnet deployment."
            />
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="p-12 md:p-16 rounded-3xl bg-white/[0.02] border border-white/5 text-center">
            <h2 className="text-4xl md:text-5xl font-bold mb-4 tracking-tight">
              Ready to Start?
            </h2>
            <p className="text-lg text-neutral-400 mb-8 max-w-xl mx-auto">
              Join the future of decentralized derivatives on Stellar.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button className="group px-8 py-4 bg-white text-black hover:bg-neutral-100 rounded-xl font-medium text-lg transition-all">
                Launch App
                <span className="inline-block ml-2 transition-transform group-hover:translate-x-1">→</span>
              </button>
              <button className="px-8 py-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl font-medium text-lg transition-all">
                Join Community
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-16 px-6 border-t border-white/5">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-4 gap-12 mb-12">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center font-bold text-black">
                  N
                </div>
                <span className="text-lg font-semibold">Noether</span>
              </div>
              <p className="text-neutral-600 text-sm">
                Decentralized perpetual exchange on Stellar.
              </p>
            </div>

            <div>
              <h4 className="font-medium mb-4 text-neutral-400 text-sm uppercase tracking-wider">Product</h4>
              <ul className="space-y-2 text-neutral-500">
                <li><a href="#" className="hover:text-white transition-colors">Trade</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Earn</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Docs</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-medium mb-4 text-neutral-400 text-sm uppercase tracking-wider">Resources</h4>
              <ul className="space-y-2 text-neutral-500">
                <li><a href="#" className="hover:text-white transition-colors">GitHub</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Blog</a></li>
                <li><a href="#" className="hover:text-white transition-colors">FAQ</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-medium mb-4 text-neutral-400 text-sm uppercase tracking-wider">Community</h4>
              <ul className="space-y-2 text-neutral-500">
                <li><a href="#" className="hover:text-white transition-colors">Discord</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Twitter</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Telegram</a></li>
              </ul>
            </div>
          </div>

          <div className="pt-8 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-neutral-600 text-sm">
              Named after Emmy Noether, whose theorem on symmetry revolutionized physics.
            </p>
            <p className="text-neutral-700 text-sm">
              Built on Stellar
            </p>
          </div>
        </div>
      </footer>
    </main>
  );
}

// Components

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      <div className="text-3xl md:text-4xl font-semibold text-white">
        {value}
      </div>
      <div className="text-neutral-600 text-sm mt-1">{label}</div>
    </div>
  );
}

function FeatureCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="group p-6 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-white/10 hover:bg-white/[0.03] transition-all">
      <h3 className="text-lg font-medium mb-2">{title}</h3>
      <p className="text-neutral-500 text-sm leading-relaxed">{description}</p>
    </div>
  );
}

function ListItem({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0 mt-2" />
      <span className="text-neutral-400 text-sm">{text}</span>
    </li>
  );
}

function StepCard({ number, title, description }: { number: string; title: string; description: string }) {
  return (
    <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5">
      <div className="text-xs text-neutral-600 font-mono mb-4">{number}</div>
      <h3 className="text-lg font-medium mb-2">{title}</h3>
      <p className="text-neutral-500 text-sm">{description}</p>
    </div>
  );
}

function RoadmapItem({ phase, title, items, status }: { phase: string; title: string; items: string[]; status: "completed" | "in-progress" | "upcoming" }) {
  const statusStyles = {
    completed: "bg-emerald-400/10 text-emerald-400 border-emerald-400/20",
    "in-progress": "bg-white/10 text-white border-white/20",
    upcoming: "bg-neutral-800 text-neutral-500 border-neutral-700",
  };

  const statusLabels = {
    completed: "Done",
    "in-progress": "Current",
    upcoming: "Planned",
  };

  return (
    <div className="flex items-start gap-4 p-5 rounded-xl bg-white/[0.02] border border-white/5">
      <span className={`px-2.5 py-1 rounded-md text-xs font-medium border ${statusStyles[status]}`}>
        {statusLabels[status]}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 mb-1">
          <span className="text-neutral-600 text-sm">{phase}</span>
          <h3 className="font-medium">{title}</h3>
        </div>
        <p className="text-neutral-600 text-sm">{items.join(" · ")}</p>
      </div>
    </div>
  );
}

function FAQItem({ question, answer }: { question: string; answer: string }) {
  return (
    <details className="group p-5 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-all">
      <summary className="flex items-center justify-between cursor-pointer list-none">
        <span className="font-medium">{question}</span>
        <span className="text-xl text-neutral-600 group-open:rotate-45 transition-transform">+</span>
      </summary>
      <p className="mt-4 text-neutral-500 text-sm leading-relaxed">{answer}</p>
    </details>
  );
}
