'use client';

import { useRef, useState } from 'react';
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

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Share Trade" size="md">
      <div className="flex flex-col items-center gap-4">
        <PnlShareCard ref={cardRef} data={data} />

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
