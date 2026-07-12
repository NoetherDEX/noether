import '@/components/landing/landing.css';
import {
  Navbar,
  Hero,
  FlagshipSection,
  ProtocolNewsSection,
  LandingFooter,
} from '@/components/landing';

export default function Home() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <FlagshipSection />
        <ProtocolNewsSection />
        <LandingFooter />
      </main>
    </>
  );
}
