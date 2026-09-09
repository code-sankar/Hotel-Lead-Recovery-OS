'use client';

/**
 * Last-resort boundary: catches failures in the root layout itself, where the
 * normal error boundary cannot render. It must ship its own <html> and <body>.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          background: '#f8fafc',
          color: '#0f172a',
        }}
      >
        <main style={{ maxWidth: '32rem', padding: '2rem' }}>
          <h1 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0 }}>
            Lead Stay could not start
          </h1>
          <p style={{ fontSize: '0.8125rem', color: '#475569', marginTop: '0.25rem' }}>
            This usually means the environment is not configured yet.
          </p>
          <pre
            style={{
              marginTop: '1rem',
              padding: '0.625rem 0.75rem',
              borderRadius: '0.375rem',
              background: '#e2e8f0',
              fontSize: '0.75rem',
              overflowX: 'auto',
            }}
          >
            {error.message}
          </pre>
          <p style={{ fontSize: '0.8125rem', marginTop: '1rem' }}>
            <a href="/setup" style={{ color: '#4f46e5', fontWeight: 500 }}>
              Run the setup checks
            </a>
          </p>
        </main>
      </body>
    </html>
  );
}
