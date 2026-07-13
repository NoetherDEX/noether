import Link from 'next/link';
import { NoetherLogo } from '@/components/landing/NoetherLogo';
import { DISCORD_URL } from '@/lib/utils/constants';

function DiscordIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4" aria-hidden="true">
      <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
    </svg>
  );
}

export default function NotFound() {
  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
            [data-noether-chrome] { display: none !important; }
            @keyframes noether-404-fade {
              from { opacity: 0; transform: translateY(8px); }
              to { opacity: 1; transform: translateY(0); }
            }
            .noether-404-anim { opacity: 0; animation: noether-404-fade 600ms ease-out forwards; }
            .noether-404-anim-1 { animation-delay: 0ms; }
            .noether-404-anim-2 { animation-delay: 120ms; }
            .noether-404-anim-3 { animation-delay: 240ms; }
            .noether-404-anim-4 { animation-delay: 360ms; }
            @media (prefers-reduced-motion: reduce) {
              .noether-404-anim { animation: none; opacity: 1; }
            }
          `,
        }}
      />
      <main className="min-h-screen w-full bg-background flex flex-col items-center justify-center px-6 relative overflow-hidden">
        <Link
          href="/"
          aria-label="Noether home"
          className="noether-404-anim noether-404-anim-1 absolute top-8 left-1/2 -translate-x-1/2 opacity-50 hover:opacity-90 transition-opacity"
        >
          <NoetherLogo className="h-5 w-auto" />
        </Link>

        <div className="flex flex-col items-center text-center max-w-md w-full">
          <h1 className="noether-404-anim noether-404-anim-2 font-heading text-primary/85 font-light leading-none tracking-tight text-[7rem] sm:text-[9rem]">
            404
          </h1>

          <p className="noether-404-anim noether-404-anim-3 mt-6 text-sm text-muted-foreground tracking-wide">
            This page doesn't exist.
          </p>

          <div className="noether-404-anim noether-404-anim-4 mt-10 flex flex-col sm:flex-row items-center gap-3 sm:gap-4 w-full sm:w-auto">
            <Link
              href="/trade"
              className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary/60 focus:ring-offset-2 focus:ring-offset-background"
            >
              Back to Trade
            </Link>
            <a
              href={DISCORD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-md border border-border text-muted-foreground text-sm font-medium hover:border-primary/40 hover:text-foreground transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2 focus:ring-offset-background"
            >
              <DiscordIcon />
              Join Discord
              <span aria-hidden="true" className="text-faint">↗</span>
            </a>
          </div>
        </div>
      </main>
    </>
  );
}
