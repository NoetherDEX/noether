import {
  Navbar,
  Hero,
  StatsStrip,
  FeaturesGrid,
  UserSegments,
  HowItWorks,
  Footer,
} from '@/components/landing';

export default function Home() {
  return (
    <main className="min-h-screen bg-[#051015] text-white overflow-x-hidden">
      <Navbar />
      <Hero />
      <StatsStrip />
      <FeaturesGrid />
      <UserSegments />
      <HowItWorks />
      <Footer />
    </main>
  );
}
