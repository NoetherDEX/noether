'use client';

import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { Modal, Button } from '@/components/ui';
import { PnlShareCard } from './PnlShareCard';
import { downloadPnlImage } from '@/lib/utils/shareImage';
import type { PnlShareData } from '@/types';

interface PnlShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: PnlShareData | null;
}

// The card renders at a fixed 480px so the downloaded PNG is always crisp
// and identical — the MODAL scales it visually to fit small screens (B25:
// it used to overflow its own modal on phones).
const CARD_WIDTH = 480;

export function PnlShareModal({ isOpen, onClose, data }: PnlShareModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (!isOpen) return;
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setScale(Math.min(1, el.clientWidth / CARD_WIDTH));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isOpen]);

  if (!data) return null;

  const handleDownload = async () => {
    if (!cardRef.current) return;
    setIsGenerating(true);
    try {
      await downloadPnlImage(cardRef.current, data.asset, data.direction);
    } catch (err) {
      console.error('Failed to generate image:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Share Trade" size="md">
      <div className="flex flex-col items-center gap-4">
        {/* zoom (not transform) so layout height shrinks with the visual —
            the download capture targets the card node itself, unaffected. */}
        <div ref={wrapRef} className="w-full flex justify-center">
          <div style={{ zoom: scale }}>
            <PnlShareCard ref={cardRef} data={data} />
          </div>
        </div>

        <Button
          variant="primary"
          className="w-full"
          onClick={handleDownload}
          disabled={isGenerating}
        >
          <Download className="w-4 h-4 mr-2" />
          {isGenerating ? 'Generating...' : 'Download PNG'}
        </Button>
      </div>
    </Modal>
  );
}
