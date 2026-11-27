'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { cx, Loading, Select } from '../../components/ui';
import { api, type Me, type ModelsResponse } from '../../lib/api';
import { authClient } from '../../lib/auth-client';

const NAV = [
  { href: '/sites', label: 'Sites' },
  { href: '/articles', label: 'Articles' },
  { href: '/templates', label: 'Templates' },
  { href: '/settings', label: 'Settings' },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const session = authClient.useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  // Navigating closes the mobile menu.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the trigger, not a value used inside.
  useEffect(() => setMenuOpen(false), [pathname]);
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me'), enabled: !!session.data });
  const models = useQuery({
    queryKey: ['models'],
    queryFn: () => api<ModelsResponse>('/models'),
    enabled: !!session.data,
  });

  useEffect(() => {
    if (!session.isPending && !session.data) router.replace('/sign-in');
  }, [session.isPending, session.data, router]);

  if (session.isPending || !session.data || !me.data) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loading />
      </div>
    );
  }

  async function switchWorkspace(organizationId: string) {
    await authClient.organization.setActive({ organizationId });
    await queryClient.invalidateQueries();
    router.push('/sites');
  }

  async function signOut() {
    await authClient.signOut();
    queryClient.clear();
    router.replace('/sign-in');
  }

  const logo = (
    <Link href="/sites" className="flex items-center gap-2 px-2">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 font-bold text-white">T</span>
      <span className="font-semibold">TriCity Writer</span>
    </Link>
  );

  return (
    <div className="min-h-screen md:flex">
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-2 py-2.5 md:hidden">
        {logo}
        <button
          type="button"
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          aria-controls="app-menu"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <svg
            viewBox="0 0 20 20"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            {menuOpen ? <path d="M5 5l10 10M15 5L5 15" /> : <path d="M3 5h14M3 10h14M3 15h14" />}
          </svg>
        </button>
      </div>
      {menuOpen && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-30 bg-slate-900/30 md:hidden"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside
        id="app-menu"
        className={cx(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-200 bg-white px-4 py-5 transition-transform',
          'md:sticky md:top-0 md:bottom-auto md:h-screen md:w-60 md:shrink-0 md:translate-x-0',
          menuOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="mb-6">{logo}</div>
        {me.data.organizations.length > 1 && (
          <Select
            className="mb-4"
            value={me.data.organizationId}
            onChange={(e) => switchWorkspace(e.target.value)}
            aria-label="Workspace"
          >
            {me.data.organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        )}
        <nav className="space-y-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cx(
                'block rounded-lg px-3 py-2 text-sm font-medium',
                pathname.startsWith(item.href) ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100',
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto space-y-3 px-2 text-xs text-slate-500">
          {models.data?.fake && (
            <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-amber-800">
              Fake AI mode: generated articles are placeholders. Set AI_FAKE=false and add API keys.
            </p>
          )}
          <div>
            <p className="truncate font-medium text-slate-700">{me.data.user.name}</p>
            <p className="truncate">{me.data.user.email}</p>
          </div>
          <button type="button" onClick={signOut} className="text-slate-500 hover:text-slate-800">
            Sign out
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 md:px-8 md:py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
