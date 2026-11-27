'use client';

// Last resort when the root layout itself fails; it must render its own <html> and <body>.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: 22 }}>TriCity Writer is having trouble</h1>
          <p style={{ color: '#475569' }}>Please try again in a moment.</p>
          <button type="button" onClick={reset} style={{ marginTop: 12, padding: '8px 16px' }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
