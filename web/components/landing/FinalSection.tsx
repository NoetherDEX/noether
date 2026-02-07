'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Check } from 'lucide-react';
import { FadeIn, StaggerChildren, CountUp } from './animations';

const STEPS = [
  { num: 1, title: 'Get Testnet Tokens', desc: 'Visit the faucet page' },
  { num: 2, title: 'Add USDC Trustline', desc: 'Enable USDC in your wallet' },
  { num: 3, title: 'Claim Your USDC', desc: 'Get free test tokens' },
  { num: 4, title: 'Start Trading', desc: 'Open your first position' },
];

export function FinalSection() {
  const [showEmailInput, setShowEmailInput] = useState(false);
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setSubmitted(true);
  };

  return (
    <section className="snap-section section-dark flex flex-col items-center justify-center px-6 pt-28 pb-12 min-h-screen">
      <div className="max-w-[1000px] mx-auto w-full">
        <FadeIn delay={0.2}>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-heading font-bold tracking-[-0.02em] text-center mb-10">
            Four steps to your first trade
          </h2>
        </FadeIn>

        {/* Steps */}
        <StaggerChildren stagger={0.15} delay={0.3} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
          {STEPS.map((step) => (
            <FadeIn key={step.num}>
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#eab308] to-[#22c55e] flex items-center justify-center text-black font-bold text-lg mx-auto mb-4">
                  {step.num}
                </div>
                <h3 className="font-semibold text-base mb-1">{step.title}</h3>
                <p className="text-sm text-white/45">{step.desc}</p>
              </div>
            </FadeIn>
          ))}
        </StaggerChildren>

        {/* Competition Banner */}
        <FadeIn delay={0.5}>
          <div className="relative rounded-3xl p-12 md:p-16 text-center overflow-hidden border border-white/[0.06]"
            style={{
              background: 'linear-gradient(135deg, rgba(234, 179, 8, 0.04), rgba(34, 197, 94, 0.04))',
            }}
          >
            {/* Decorative orbs */}
            <div className="absolute top-0 right-0 w-[300px] h-[300px] opacity-10 pointer-events-none"
              style={{ background: 'radial-gradient(circle, #eab308, transparent 70%)', filter: 'blur(60px)' }}
            />
            <div className="absolute bottom-0 left-0 w-[200px] h-[200px] opacity-8 pointer-events-none"
              style={{ background: 'radial-gradient(circle, #22c55e, transparent 70%)', filter: 'blur(50px)' }}
            />

            <div className="relative z-10">
              <div className="flex items-center justify-center gap-2 mb-6">
                <motion.div
                  className="w-2 h-2 rounded-full bg-[#eab308]"
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
                <span className="text-xs font-medium uppercase tracking-[0.2em] text-white/50">
                  Coming Soon
                </span>
              </div>

              <div className="text-5xl md:text-6xl lg:text-7xl font-heading font-bold text-gradient-gold-green mb-4">
                $<CountUp target={20000} duration={2} />
              </div>

              <h3 className="text-xl md:text-2xl font-semibold mb-3">Trading Competition</h3>
              <p className="text-white/45 max-w-[400px] mx-auto mb-8 text-sm">
                Compete against other traders for the prize pool. Show your skills and earn rewards.
              </p>

              <AnimatePresence mode="wait">
                {submitted ? (
                  <motion.div
                    key="success"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center justify-center gap-2 text-[#22c55e]"
                  >
                    <Check className="w-5 h-5" />
                    <span className="text-sm font-medium">You&apos;re on the waitlist!</span>
                  </motion.div>
                ) : showEmailInput ? (
                  <motion.form
                    key="email-form"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    onSubmit={handleSubmit}
                    className="flex flex-col sm:flex-row gap-3 max-w-[420px] mx-auto"
                  >
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Enter your email"
                      required
                      autoFocus
                      className="flex-1 h-11 bg-white/[0.06] border border-white/10 rounded-full px-5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#eab308]/40 transition-colors"
                    />
                    <button
                      type="submit"
                      className="h-11 px-6 rounded-full bg-gradient-to-r from-[#eab308] to-[#22c55e] text-black text-sm font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity shrink-0"
                    >
                      Submit
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </motion.form>
                ) : (
                  <motion.button
                    key="join-btn"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    onClick={() => setShowEmailInput(true)}
                    className="pill-button pill-button-filled"
                  >
                    Join Waitlist
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
