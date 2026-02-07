'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';

/* ── Context ── */
interface SlideContextValue {
  flagshipPhase: 0 | 1;
  noeIntroPhase: 0 | 1 | 2;
}

const SlideContext = createContext<SlideContextValue>({ flagshipPhase: 0, noeIntroPhase: 0 });
export const useSlideContext = () => useContext(SlideContext);

/* ════════════════════════════════════════════════════════════
   SlideContainer — Fullpage slide-based scroll controller

   Every .snap-section is treated as a "slide."
   Sections with data-phases="N" have N internal phases
   that must be traversed before moving to the next slide.
   All wheel/touch events are intercepted; scrolling is
   100% controlled by this component.
   ════════════════════════════════════════════════════════════ */
export function SlideContainer({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sectionIdx = useRef(0);
  const sectionPhase = useRef(0);
  const isLocked = useRef(false);
  const [flagshipPhase, setFlagshipPhase] = useState<0 | 1>(0);
  const [noeIntroPhase, setNoeIntroPhase] = useState<0 | 1 | 2>(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Start at top
    container.scrollTop = 0;

    /* ── Helpers ── */
    const getSections = () =>
      container.querySelectorAll<HTMLElement>('.snap-section');

    const getMaxPhase = (index: number) => {
      const sections = getSections();
      const section = sections[index];
      if (!section) return 0;
      return parseInt(section.dataset.phases || '1', 10) - 1;
    };

    const scrollToSection = (index: number) => {
      const sections = getSections();
      const target = sections[index];
      if (!target) return;
      container.scrollTo({ top: target.offsetTop, behavior: 'smooth' });
    };

    const FLAGSHIP_INDEX = 1; // FlagshipSection is the 2nd snap-section
    const NOE_INTRO_INDEX = 2; // NOEIntroSection is the 3rd snap-section

    const updateFlagshipPhase = (phase: number) => {
      setFlagshipPhase(phase as 0 | 1);
    };

    const updateNoeIntroPhase = (phase: number) => {
      setNoeIntroPhase(phase as 0 | 1 | 2);
    };

    /* ── Navigate ── */
    const navigate = (direction: 'down' | 'up') => {
      if (isLocked.current) return;

      const idx = sectionIdx.current;
      const phase = sectionPhase.current;
      const maxPhase = getMaxPhase(idx);
      const totalSections = getSections().length;

      isLocked.current = true;

      if (direction === 'down') {
        if (phase < maxPhase) {
          // Advance internal phase
          sectionPhase.current = phase + 1;
          if (idx === FLAGSHIP_INDEX) updateFlagshipPhase(phase + 1);
          if (idx === NOE_INTRO_INDEX) updateNoeIntroPhase(phase + 1);
          setTimeout(() => { isLocked.current = false; }, 1000);
        } else if (idx < totalSections - 1) {
          // Next section
          sectionIdx.current = idx + 1;
          sectionPhase.current = 0;
          scrollToSection(idx + 1);
          setTimeout(() => { isLocked.current = false; }, 1200);
        } else {
          // Already at last section
          isLocked.current = false;
        }
      } else {
        if (phase > 0) {
          // Retreat internal phase
          sectionPhase.current = phase - 1;
          if (idx === FLAGSHIP_INDEX) updateFlagshipPhase(phase - 1);
          if (idx === NOE_INTRO_INDEX) updateNoeIntroPhase(phase - 1);
          setTimeout(() => { isLocked.current = false; }, 1000);
        } else if (idx > 0) {
          // Previous section (enter at its last phase)
          const prevIdx = idx - 1;
          const prevMaxPhase = getMaxPhase(prevIdx);
          sectionIdx.current = prevIdx;
          sectionPhase.current = prevMaxPhase;
          if (prevIdx === FLAGSHIP_INDEX) updateFlagshipPhase(prevMaxPhase);
          if (prevIdx === NOE_INTRO_INDEX) updateNoeIntroPhase(prevMaxPhase);
          scrollToSection(prevIdx);
          setTimeout(() => { isLocked.current = false; }, 1200);
        } else {
          // Already at first section
          isLocked.current = false;
        }
      }
    };

    /* ── Wheel ── */
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (isLocked.current) return;
      if (Math.abs(e.deltaY) < 3) return;
      navigate(e.deltaY > 0 ? 'down' : 'up');
    };

    /* ── Touch ── */
    let touchStartY = 0;
    const handleTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0].clientY;
    };
    const handleTouchMove = (e: TouchEvent) => {
      // Prevent native scroll on touch devices
      e.preventDefault();
    };
    const handleTouchEnd = (e: TouchEvent) => {
      if (isLocked.current) return;
      const deltaY = touchStartY - e.changedTouches[0].clientY;
      if (Math.abs(deltaY) < 40) return;
      navigate(deltaY > 0 ? 'down' : 'up');
    };

    /* ── Keyboard ── */
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isLocked.current) return;
      if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        navigate('down');
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        navigate('up');
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <SlideContext.Provider value={{ flagshipPhase, noeIntroPhase }}>
      <main ref={containerRef} className="snap-container bg-[#050508] text-white">
        {children}
      </main>
    </SlideContext.Provider>
  );
}
