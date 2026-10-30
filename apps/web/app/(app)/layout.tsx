'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
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

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white px-4 py-5">
        <Link href="/sites" className="mb-6 flex items-center gap-2 px-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 font-bold text-white">
            T
          </span>
          <span className="font-semibold">TriCity Writer</span>
        </Link>
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
      <main className="min-w-0 flex-1 px-8 py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
