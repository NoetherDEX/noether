'use client';

import { useRef, useState } from 'react';
import { Download, Twitter } from 'lucide-react';
import { Modal, Button } from '@/components/ui';
import { PnlShareCard } from './PnlShareCard';
import { downloadPnlImage, shareToTwitter } from '@/lib/utils/shareImage';
import type { PnlShareData } from '@/types';

interface PnlShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: PnlShareData | null;
}

export function PnlShareModal({ isOpen, onClose, data }: PnlShareModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);

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

  const handleShareTwitter = () => {
    shareToTwitter(data);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Share Trade" size="md">
      <div className="flex flex-col items-center gap-4">
        <PnlShareCard ref={cardRef} data={data} />

        <div className="flex gap-3 w-full">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={handleDownload}
            disabled={isGenerating}
          >
            <Download className="w-4 h-4 mr-2" />
            {isGenerating ? 'Generating...' : 'Download PNG'}
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            onClick={handleShareTwitter}
          >
            <Twitter className="w-4 h-4 mr-2" />
            Share on X
          </Button>
        </div>
      </div>
    </Modal>
  );
}
