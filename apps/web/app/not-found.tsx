import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-sm text-center">
        <p className="text-sm font-semibold text-brand-600">404</p>
        <h1 className="mt-2 text-2xl font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-slate-600">The link may be old, or the page was moved or deleted.</p>
        <Link
          href="/sites"
          className="mt-6 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Go to your sites
        </Link>
      </div>
    </div>
  );
}
