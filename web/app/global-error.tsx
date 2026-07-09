'use client';

import { useEffect } from 'react';

/**
 * Global error boundary — the last resort for errors thrown in the root layout
 * itself, where app/error.tsx cannot mount. It replaces the entire document,
 * so it renders its own <html>/<body> and uses inline styles rather than the
 * app stylesheet (which may not have loaded when the layout throws).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[app/global-error]', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0a0a0a',
          color: '#fafafa',
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
          padding: '1rem',
        }}
      >
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 8px' }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: 14, color: '#a1a1aa', margin: '0 0 20px', lineHeight: 1.5 }}>
            Noether hit an unexpected error while loading. Please reload the page.
          </p>
          <button
            onClick={() => reset()}
            style={{
              background: '#eab308',
              color: '#000',
              border: 'none',
              borderRadius: 10,
              padding: '10px 20px',
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
