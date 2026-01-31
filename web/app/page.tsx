import '@/components/landing/landing.css';
import {
  StarsBackground,
  Navbar,
  Hero,
  TradersSection,
  VaultSection,
  CompetitionBanner,
  GettingStarted,
  Footer,
} from '@/components/landing';

export default function Home() {
  return (
    <main className="min-h-screen bg-[#050508] text-white overflow-x-hidden relative">
      <StarsBackground />
      <Navbar />
      <Hero />
      <TradersSection />
      <VaultSection />
      <CompetitionBanner />
      <GettingStarted />
      <Footer />
    </main>
  );
}
