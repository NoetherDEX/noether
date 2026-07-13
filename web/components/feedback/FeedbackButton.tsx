'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, Send, X, Bug, Lightbulb, MessageCircle } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import toast from 'react-hot-toast';

const categories = [
  { id: 'bug', label: 'Bug Report', icon: Bug },
  { id: 'feature', label: 'Feature Request', icon: Lightbulb },
  { id: 'general', label: 'General', icon: MessageCircle },
] as const;

type Category = (typeof categories)[number]['id'];

const SUPPORT_EMAIL = 'support@noether.exchange';

export function FeedbackButton() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [category, setCategory] = useState<Category>('general');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  if (pathname === '/') return null;

  // On /trade below lg the fixed MobileTradeBar owns the bottom edge — hide the
  // FAB there so it can never cover the Short button's tap zone (bottom-chrome
  // coordination; the banner half is handled in ReferralBanner).
  const hideOnMobileTrade = pathname === '/trade';

  const handleSubmit = () => {
    if (!message.trim()) {
      toast.error('Please enter a message');
      return;
    }

    const categoryLabel = categories.find((c) => c.id === category)?.label ?? 'General';
    const fullSubject = subject.trim()
      ? `[${categoryLabel}] ${subject.trim()}`
      : `[${categoryLabel}] Feedback`;

    const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(fullSubject)}&body=${encodeURIComponent(message)}`;
    window.open(mailto, '_blank');

    toast.success('Email client opened!');
    setCategory('general');
    setSubject('');
    setMessage('');
    setIsOpen(false);
  };

  return (
    <>
      {/* Floating Action Button */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            data-noether-chrome
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            onClick={() => setIsOpen(true)}
            className={`fixed bottom-6 right-6 z-40 ${hideOnMobileTrade ? 'hidden lg:flex' : 'flex'} items-center gap-2 px-4 py-3
                       bg-surface border border-border rounded-full
                       hover:border-primary/40 hover:bg-surface-2
                       transition-colors duration-300 group cursor-pointer`}
            aria-label="Send feedback"
          >
            <MessageSquare className="w-5 h-5 text-primary" />
            <span className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">
              Feedback
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Feedback Modal */}
      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Send Feedback" size="md">
        <div className="space-y-5">
          {/* Category Pills */}
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2.5">
              Category
            </label>
            <div className="flex gap-2">
              {categories.map((cat) => {
                const Icon = cat.icon;
                const active = category === cat.id;
                return (
                  <button
                    key={cat.id}
                    onClick={() => setCategory(cat.id)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors duration-200 cursor-pointer
                      ${active
                        ? 'bg-primary/10 text-primary border border-primary/30'
                        : 'bg-surface-2 text-muted-foreground border border-border hover:bg-surface-3 hover:text-foreground'
                      }`}
                  >
                    <Icon className="w-4 h-4" />
                    {cat.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Subject */}
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">
              Subject <span className="text-faint">(optional)</span>
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Brief summary…"
              className="w-full bg-surface-2 border border-border rounded-md px-4 py-3 text-foreground placeholder:text-faint
                         focus:outline-none focus:border-border-strong focus:ring-1 focus:ring-ring
                         transition-colors duration-200"
            />
          </div>

          {/* Message */}
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">
              Message
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Tell us what's on your mind…"
              rows={4}
              className="w-full bg-surface-2 border border-border rounded-md px-4 py-3 text-foreground placeholder:text-faint
                         focus:outline-none focus:border-border-strong focus:ring-1 focus:ring-ring
                         transition-colors duration-200 resize-none"
            />
          </div>

          {/* Destination hint */}
          <p className="text-xs text-faint">
            This will open your email client to send feedback to{' '}
            <span className="text-muted-foreground">{SUPPORT_EMAIL}</span>
          </p>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            className="w-full flex items-center justify-center gap-2 px-4 py-3
                       bg-primary text-primary-foreground font-medium rounded-md
                       hover:bg-primary/90 transition-colors duration-200
                       focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-background
                       cursor-pointer"
          >
            <Send className="w-4 h-4" />
            Send Feedback
          </button>
        </div>
      </Modal>
    </>
  );
}
