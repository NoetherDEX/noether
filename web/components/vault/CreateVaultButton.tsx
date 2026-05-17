'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';
import { CreateVaultModal } from './CreateVaultModal';

export function CreateVaultButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Create vault</Button>
      <CreateVaultModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
