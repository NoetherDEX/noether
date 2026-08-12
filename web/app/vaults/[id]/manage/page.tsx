import { notFound, redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * B19: one leader surface, not two. This route was an orphaned, headerless
 * second trading UI (blind opens of follower money with no price/size/liq
 * info, closes by hand-typed position id, reachable only by typing the URL).
 * Leader mode on /trade IS the account-context switcher, and the vault
 * detail page now carries claim + pause + deposit/withdraw — so this
 * redirects there.
 */
export default function VaultManagePage({ params }: { params: { id: string } }) {
  // Canonical digit string only — see the note in ../page.tsx.
  if (!/^\d+$/.test(params.id)) notFound();
  redirect(`/trade?vault=${Number(params.id)}`);
}
