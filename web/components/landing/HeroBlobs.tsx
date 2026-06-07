'use client';

import { useEffect, useRef } from 'react';

function hash(x: number, y: number) {
  return ((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1 + 1) % 1;
}

const GRID = 6;
const BAR_W = 1.5;
const GLOW_R = 160;

interface Bar {
  x: number;
  y: number;
  h: number;
  w: number;
  type: number;
}

export function HeroBlobs() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouse = useRef({ x: -9999, y: -9999 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Respect reduced-motion — the CSS also hides the canvas, so just bail
    // (no listeners, no rAF loop).
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    let raf = 0;
    let running = false;
    let inView = true;
    let bars: Bar[] = [];
    let cw = 0;
    let ch = 0;

    const rebuild = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.parentElement!.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      cw = rect.width;
      ch = rect.height;

      bars = [];
      for (let gy = 0; gy * GRID < ch; gy++) {
        for (let gx = 0; gx * GRID < cw; gx++) {
          const x = gx * GRID;
          const y = gy * GRID;
          const r = hash(gx, gy);
          const type = r < 0.6 ? 0 : r < 0.82 ? 1 : 2;

          let h: number;
          let w = BAR_W;
          if (type === 2) {
            h = 2;
            w = 2;
          } else if (type === 1) {
            h = BAR_W;
            w = 2 + hash(gx + 31, gy + 17) * 5;
          } else {
            h = 2 + hash(gx + 99, gy + 77) * 10;
          }

          bars.push({ x, y, h, w, type });
        }
      }
    };

    // Draw exactly one frame (the field glows near the cursor; with the cursor
    // away every bar sits at the base alpha — i.e. the resting look).
    const renderFrame = () => {
      ctx.clearRect(0, 0, cw, ch);

      const mx = mouse.current.x;
      const my = mouse.current.y;

      for (let i = 0; i < bars.length; i++) {
        const b = bars[i];
        const dx = b.x - mx;
        const dy = b.y - my;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const prox = Math.max(0, 1 - dist / GLOW_R);
        const boost = prox * prox;
        const alpha = 0.10 + boost * 0.7;

        ctx.fillStyle = `rgba(234,179,8,${alpha})`;

        if (b.type === 2) {
          ctx.fillRect(b.x - 1, b.y - 1, 2, 2);
        } else if (b.type === 1) {
          ctx.fillRect(b.x - b.w / 2, b.y - BAR_W / 2, b.w, BAR_W);
        } else {
          ctx.fillRect(b.x - BAR_W / 2, b.y - b.h / 2, BAR_W, b.h);
        }
      }
    };

    const loop = () => {
      renderFrame();
      raf = requestAnimationFrame(loop);
    };

    // Only animate while there is something to animate (cursor over the hero,
    // hero on screen, tab visible). Otherwise the field is static, so we don't
    // run a 60fps loop — this keeps the main thread free during hydration.
    const start = () => {
      if (running || !inView || document.hidden) return;
      running = true;
      raf = requestAnimationFrame(loop);
    };

    const stop = () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (x >= 0 && x <= cw && y >= 0 && y <= ch) {
        mouse.current.x = x;
        mouse.current.y = y;
        start();
      } else if (mouse.current.x !== -9999) {
        // Cursor left the hero: settle to the resting frame once, then idle.
        mouse.current.x = -9999;
        mouse.current.y = -9999;
        stop();
        renderFrame();
      }
    };

    const onResize = () => {
      rebuild();
      renderFrame();
    };

    const onVisibility = () => {
      if (document.hidden) stop();
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        inView = entry.isIntersecting;
        if (!inView) stop();
      },
      { threshold: 0 }
    );
    io.observe(canvas);

    rebuild();
    renderFrame(); // paint the resting state once — no continuous loop on load

    window.addEventListener('resize', onResize);
    window.addEventListener('mousemove', onMove);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      io.disconnect();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  );
}
