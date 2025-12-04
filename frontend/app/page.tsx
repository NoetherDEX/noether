"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { ArrowRight, FileText, Shield, Layers, TrendingUp, ChevronDown, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"

// Animated counter component
function AnimatedCounter({ end, suffix = "", prefix = "" }: { end: number; suffix?: string; prefix?: string }) {
  const [count, setCount] = useState(0)

  useEffect(() => {
    const duration = 2000
    const steps = 60
    const increment = end / steps
    let current = 0

    const timer = setInterval(() => {
      current += increment
      if (current >= end) {
        setCount(end)
        clearInterval(timer)
      } else {
        setCount(Math.floor(current))
      }
    }, duration / steps)

    return () => clearInterval(timer)
  }, [end])

  return <span>{prefix}{count.toLocaleString()}{suffix}</span>
}

// Navbar Component
function LandingNavbar() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener("scroll", handleScroll)
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  return (
    <nav className={cn(
      "fixed top-0 left-0 right-0 z-50 transition-all duration-300",
      scrolled ? "bg-[#0a0a12]/80 backdrop-blur-xl border-b border-white/5" : "bg-transparent"
    )}>
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500 to-cyan-400 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold text-white">Noether</span>
        </Link>

        <div className="hidden md:flex items-center gap-8">
          <Link href="#features" className="text-gray-400 hover:text-white transition-colors">
            Ecosystem
          </Link>
          <Link href="#theorem" className="text-gray-400 hover:text-white transition-colors">
            Governance
          </Link>
          <Link href="#" className="text-gray-400 hover:text-white transition-colors">
            Docs
          </Link>
        </div>

        <Link
          href="/trade"
          className="px-5 py-2.5 rounded-lg border border-cyan-400/50 text-cyan-400 hover:bg-cyan-400/10 transition-all duration-300 font-medium"
        >
          Connect Wallet
        </Link>
      </div>
    </nav>
  )
}

// Hero Section
function HeroSection() {
  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center px-6 pt-20 overflow-hidden">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-[#0a0a12]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-violet-900/20 via-transparent to-transparent" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-gradient-to-r from-cyan-500/10 to-violet-500/10 rounded-full blur-3xl" />

      {/* Animated circles */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] border border-white/5 rounded-full animate-pulse" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] border border-white/5 rounded-full" style={{ animationDelay: "0.5s" }} />

      <div className="relative z-10 text-center max-w-4xl mx-auto">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 mb-8">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-sm text-gray-300">Live on Stellar Mainnet</span>
        </div>

        {/* Main Headline */}
        <h1 className="text-5xl md:text-7xl font-bold mb-6 leading-tight">
          <span className="bg-gradient-to-r from-cyan-400 via-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
            The Conservation
          </span>
          <br />
          <span className="text-white">of Liquidity.</span>
        </h1>

        {/* Subheadline */}
        <p className="text-lg md:text-xl text-gray-400 mb-10 max-w-2xl mx-auto">
          A next-generation Perpetual DEX on Stellar.{" "}
          <span className="text-gray-300">Secured by math, powered by symmetry.</span>
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
          <Link
            href="/trade"
            className="group px-8 py-4 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-500 text-white font-semibold flex items-center gap-2 hover:shadow-lg hover:shadow-cyan-500/25 transition-all duration-300"
          >
            Start Trading
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </Link>
          <Link
            href="#"
            className="px-8 py-4 rounded-xl border border-white/20 text-white font-semibold flex items-center gap-2 hover:bg-white/5 transition-all duration-300"
          >
            <FileText className="w-5 h-5" />
            Read the Whitepaper
          </Link>
        </div>

        {/* Divider */}
        <div className="w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent mb-10" />

        {/* Scroll indicator */}
        <div className="flex flex-col items-center gap-2 text-gray-500 text-sm mb-8">
          <span>Scroll to explore</span>
          <ChevronDown className="w-5 h-5 animate-bounce" />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-8 md:gap-16">
          <div className="text-center">
            <div className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-cyan-400 to-cyan-300 bg-clip-text text-transparent">
              <AnimatedCounter end={142} prefix="$" suffix="M" />
            </div>
            <div className="text-sm text-gray-500 mt-1">Total Value Locked</div>
          </div>
          <div className="text-center">
            <div className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
              <AnimatedCounter end={2.4} prefix="$" suffix="B" />
            </div>
            <div className="text-sm text-gray-500 mt-1">Trading Volume</div>
          </div>
          <div className="text-center">
            <div className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-fuchsia-400 to-pink-400 bg-clip-text text-transparent">
              <AnimatedCounter end={12847} />
            </div>
            <div className="text-sm text-gray-500 mt-1">Active Traders</div>
          </div>
        </div>
      </div>
    </section>
  )
}

// Features Section
function FeaturesSection() {
  const features = [
    {
      icon: Shield,
      title: "Oracle Guard",
      description: "Dual-layer price feeds from Band & DIA oracles. Zero manipulation, maximum accuracy.",
      color: "violet",
      gradient: "from-violet-500/20 to-violet-600/5",
      iconBg: "from-violet-500/30 to-violet-600/10",
      borderColor: "border-violet-500/20"
    },
    {
      icon: Layers,
      title: "The Vault (GLP)",
      description: "Mint GLP to earn protocol fees. A unified liquidity pool powering deep markets.",
      color: "cyan",
      gradient: "from-cyan-500/20 to-cyan-600/5",
      iconBg: "from-cyan-500/30 to-cyan-600/10",
      borderColor: "border-cyan-500/20"
    },
    {
      icon: TrendingUp,
      title: "Perpetual Futures",
      description: "Trade with up to 20x leverage. Low fees, instant settlement on Stellar.",
      color: "fuchsia",
      gradient: "from-fuchsia-500/20 to-fuchsia-600/5",
      iconBg: "from-fuchsia-500/30 to-fuchsia-600/10",
      borderColor: "border-fuchsia-500/20"
    }
  ]

  return (
    <section id="features" className="relative py-32 px-6">
      <div className="absolute inset-0 bg-[#0a0a12]" />

      <div className="relative z-10 max-w-7xl mx-auto">
        {/* Section Header */}
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            <span className="text-white">Built for </span>
            <span className="bg-gradient-to-r from-cyan-400 to-emerald-400 bg-clip-text text-transparent">
              Precision
            </span>
          </h2>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto">
            Every component engineered for maximum efficiency and security
          </p>
        </div>

        {/* Feature Cards */}
        <div className="grid md:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <div
              key={feature.title}
              className={cn(
                "group relative p-8 rounded-2xl border backdrop-blur-sm transition-all duration-500 hover:scale-[1.02]",
                feature.borderColor,
                "bg-gradient-to-br",
                feature.gradient
              )}
              style={{ animationDelay: `${index * 100}ms` }}
            >
              {/* Icon */}
              <div className={cn(
                "w-14 h-14 rounded-xl flex items-center justify-center mb-6 bg-gradient-to-br",
                feature.iconBg
              )}>
                <feature.icon className={cn(
                  "w-7 h-7",
                  feature.color === "violet" && "text-violet-400",
                  feature.color === "cyan" && "text-cyan-400",
                  feature.color === "fuchsia" && "text-fuchsia-400"
                )} />
              </div>

              {/* Content */}
              <h3 className="text-xl font-bold text-white mb-3">{feature.title}</h3>
              <p className="text-gray-400 leading-relaxed">{feature.description}</p>

              {/* Hover glow effect */}
              <div className={cn(
                "absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 -z-10 blur-xl",
                feature.color === "violet" && "bg-violet-500/10",
                feature.color === "cyan" && "bg-cyan-500/10",
                feature.color === "fuchsia" && "bg-fuchsia-500/10"
              )} />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// Theorem Section
function TheoremSection() {
  return (
    <section id="theorem" className="relative py-32 px-6">
      <div className="absolute inset-0 bg-[#0a0a12]" />

      <div className="relative z-10 max-w-4xl mx-auto">
        {/* Card with gradient border */}
        <div className="relative p-px rounded-3xl bg-gradient-to-br from-cyan-500/30 via-violet-500/30 to-fuchsia-500/30">
          <div className="relative rounded-3xl bg-[#0d0d18] p-12 md:p-16 overflow-hidden">
            {/* Background math symbols */}
            <div className="absolute inset-0 flex items-center justify-center opacity-5 text-[200px] font-serif text-white select-none pointer-events-none">
              ∂L/∂q
            </div>

            <div className="relative z-10 text-center">
              {/* Badge */}
              <div className="inline-flex px-4 py-2 rounded-full bg-white/5 border border-white/10 mb-8">
                <span className="text-sm text-gray-400">The Foundation</span>
              </div>

              {/* Title */}
              <h2 className="text-4xl md:text-5xl font-bold mb-6">
                <span className="bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">
                  Noether&apos;s
                </span>
                {" "}
                <span className="bg-gradient-to-r from-cyan-400 to-emerald-400 bg-clip-text text-transparent">
                  Theorem
                </span>
              </h2>

              {/* Quote */}
              <p className="text-2xl md:text-3xl text-gray-300 mb-8 font-light">
                &quot;Symmetry implies Conservation.&quot;
              </p>

              {/* Description */}
              <p className="text-gray-400 text-lg max-w-2xl mx-auto mb-12 leading-relaxed">
                Just as Emmy Noether proved that every symmetry in physics corresponds to a
                conservation law, our protocol ensures that every trade preserves the fundamental
                balance of your assets. Mathematical certainty, not trust.
              </p>

              {/* Equations */}
              <div className="flex flex-col md:flex-row items-center justify-center gap-8 md:gap-16">
                <div className="text-center">
                  <div className="text-2xl md:text-3xl font-mono mb-2">
                    <span className="text-cyan-400">∂L/∂q̇</span>
                    <span className="text-white"> = </span>
                    <span className="text-violet-400">p</span>
                  </div>
                  <div className="text-sm text-gray-500">Conservation of Momentum</div>
                </div>

                <div className="hidden md:block w-px h-16 bg-white/10" />

                <div className="text-center">
                  <div className="text-2xl md:text-3xl font-mono mb-2">
                    <span className="text-cyan-400">∂L/∂t</span>
                    <span className="text-white"> = </span>
                    <span className="text-violet-400">0</span>
                  </div>
                  <div className="text-sm text-gray-500">Conservation of Energy</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// CTA Section
function CTASection() {
  return (
    <section className="relative py-32 px-6">
      <div className="absolute inset-0 bg-[#0a0a12]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,_var(--tw-gradient-stops))] from-violet-900/20 via-transparent to-transparent" />

      <div className="relative z-10 max-w-4xl mx-auto text-center">
        <h2 className="text-4xl md:text-5xl font-bold mb-6">
          <span className="text-white">Ready to trade with </span>
          <span className="bg-gradient-to-r from-cyan-400 via-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
            mathematical precision?
          </span>
        </h2>

        <p className="text-gray-400 text-lg mb-10 max-w-xl mx-auto">
          Join thousands of traders who trust Noether for their perpetual trading needs.
        </p>

        <Link
          href="/trade"
          className="inline-flex items-center gap-2 px-10 py-5 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-500 text-white font-semibold text-lg hover:shadow-lg hover:shadow-violet-500/25 transition-all duration-300 group"
        >
          Launch App
          <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
        </Link>
      </div>
    </section>
  )
}

// Footer
function Footer() {
  return (
    <footer className="relative py-8 px-6 border-t border-white/5">
      <div className="absolute inset-0 bg-[#0a0a12]" />

      <div className="relative z-10 max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-cyan-400 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <span className="text-lg font-bold text-white">Noether</span>
        </Link>

        <div className="flex items-center gap-8">
          <Link href="#" className="text-sm text-gray-500 hover:text-white transition-colors">Terms</Link>
          <Link href="#" className="text-sm text-gray-500 hover:text-white transition-colors">Privacy</Link>
          <Link href="#" className="text-sm text-gray-500 hover:text-white transition-colors">Docs</Link>
          <Link href="#" className="text-sm text-gray-500 hover:text-white transition-colors">GitHub</Link>
        </div>

        <div className="text-sm text-gray-500">
          © 2025 Noether Protocol
        </div>
      </div>
    </footer>
  )
}

// Main Landing Page
export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0a0a12]">
      <LandingNavbar />
      <HeroSection />
      <FeaturesSection />
      <TheoremSection />
      <CTASection />
      <Footer />
    </div>
  )
}
