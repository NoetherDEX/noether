import '@/components/landing/landing.css';
import {
  Navbar,
  Hero,
  FlagshipSection,
  NOEIntroSection,
  VaultSection,
  FinalSection,
  LandingFooter,
  SlideContainer,
} from '@/components/landing';

export default function Home() {
  return (
    <>
      <Navbar />
      <SlideContainer>
        <Hero />
        <FlagshipSection />
        <NOEIntroSection />
        <VaultSection />
        <FinalSection />
        <LandingFooter />
      </SlideContainer>
    </>
  );
}
