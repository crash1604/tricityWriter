'use client';

import Link from 'next/link';
import { useEffect } from 'react';

// Shown when a page throws while rendering. The app layout (sidebar) is replaced, so it links home.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-sm text-center">
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-slate-600">
          This page hit an unexpected error. Try again; if it keeps happening, reload the page.
        </p>
        {error.digest && <p className="mt-2 font-mono text-xs text-slate-400">Reference: {error.digest}</p>}
        <div className="mt-6 flex justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Try again
          </button>
          <Link
            href="/sites"
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
          >
            Go to your sites
          </Link>
        </div>
      </div>
    </div>
  );
}
