'use client';

import { useState } from 'react';
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
  const [isOpen, setIsOpen] = useState(false);
  const [category, setCategory] = useState<Category>('general');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

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
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            onClick={() => setIsOpen(true)}
            className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-3
                       bg-[#0a0a0c] border border-white/10 rounded-full shadow-lg
                       hover:border-[#eab308]/40 hover:shadow-[0_0_20px_rgba(234,179,8,0.15)]
                       transition-all duration-300 group cursor-pointer"
            aria-label="Send feedback"
          >
            <MessageSquare className="w-5 h-5 text-[#eab308] group-hover:scale-110 transition-transform" />
            <span className="text-sm font-medium text-neutral-300 group-hover:text-white transition-colors">
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
            <label className="block text-sm font-medium text-neutral-400 mb-2.5">
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
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer
                      ${active
                        ? 'bg-[#eab308]/15 text-[#eab308] border border-[#eab308]/30'
                        : 'bg-white/5 text-neutral-400 border border-white/10 hover:bg-white/10 hover:text-white'
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
            <label className="block text-sm font-medium text-neutral-400 mb-2">
              Subject <span className="text-neutral-600">(optional)</span>
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Brief summary..."
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-neutral-600
                         focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/20
                         transition-all duration-200"
            />
          </div>

          {/* Message */}
          <div>
            <label className="block text-sm font-medium text-neutral-400 mb-2">
              Message
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Tell us what's on your mind..."
              rows={4}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-neutral-600
                         focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/20
                         transition-all duration-200 resize-none"
            />
          </div>

          {/* Destination hint */}
          <p className="text-xs text-neutral-500">
            This will open your email client to send feedback to{' '}
            <span className="text-neutral-400">{SUPPORT_EMAIL}</span>
          </p>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            className="w-full flex items-center justify-center gap-2 px-4 py-3
                       bg-[#eab308] text-black font-semibold rounded-xl
                       hover:bg-[#ca9a04] transition-colors duration-200
                       focus:outline-none focus:ring-2 focus:ring-[#eab308]/50 focus:ring-offset-2 focus:ring-offset-[#0a0a0c]
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
