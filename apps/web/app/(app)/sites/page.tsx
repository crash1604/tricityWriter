'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { SiteStatusBadge, timeAgo } from '../../../components/status';
import { Button, Card, EmptyState, ErrorText, Field, Input, Loading, PageHeader } from '../../../components/ui';
import { api, type Site } from '../../../lib/api';

export default function SitesPage() {
  const queryClient = useQueryClient();
  const sites = useQuery({ queryKey: ['sites'], queryFn: () => api<{ sites: Site[] }>('/sites') });
  const [showConnect, setShowConnect] = useState(false);

  const pair = useMutation({
    mutationFn: (body: { url: string; code: string }) => api<{ site: Site }>('/sites/pair', { method: 'POST', body }),
    onSuccess: () => {
      setShowConnect(false);
      queryClient.invalidateQueries({ queryKey: ['sites'] });
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    pair.mutate({ url: String(form.get('url')), code: String(form.get('code')) });
  }

  const list = sites.data?.sites ?? [];
  const connectOpen = showConnect || (sites.isSuccess && list.length === 0);

  return (
    <>
      <PageHeader
        title="Sites"
        description="WordPress sites connected through the TriCity Writer Connector plugin."
        actions={!connectOpen && <Button onClick={() => setShowConnect(true)}>Connect a site</Button>}
      />

      {connectOpen && (
        <Card title="Connect a WordPress site" className="mb-6">
          <div className="grid gap-8 md:grid-cols-2">
            <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-600">
              <li>
                Install and activate the <strong>TriCity Writer Connector</strong> plugin on your site (upload{' '}
                <code className="rounded bg-slate-100 px-1">plugins/tricity-writer</code> as a zip).
              </li>
              <li>
                In WordPress admin, open <strong>TriCity Writer</strong>, name the connection and click{' '}
                <strong>Generate pairing code</strong>. Use an account that can publish posts.
              </li>
              <li>Paste the site address and the code here. Codes expire after 10 minutes.</li>
            </ol>
            <form onSubmit={submit} className="space-y-4">
              <Field label="Site address">
                <Input name="url" placeholder="https://example.com" required />
              </Field>
              <Field label="Pairing code">
                <Input name="code" placeholder="ABCD-EFGH-JKLM" required className="font-mono uppercase" />
              </Field>
              <ErrorText error={pair.error} />
              <div className="flex gap-2">
                <Button type="submit" busy={pair.isPending}>
                  Connect
                </Button>
                {list.length > 0 && (
                  <Button variant="ghost" onClick={() => setShowConnect(false)}>
                    Cancel
                  </Button>
                )}
              </div>
            </form>
          </div>
        </Card>
      )}

      {sites.isPending ? (
        <Loading />
      ) : sites.error ? (
        <ErrorText error={sites.error} />
      ) : list.length === 0 ? (
        <EmptyState title="No sites yet">Connect your first WordPress site to start writing.</EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {list.map((site) => (
            <Link
              key={site.id}
              href={`/sites/${site.id}`}
              className="rounded-xl bg-white p-5 ring-1 ring-slate-200 transition hover:ring-brand-500"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{site.name}</p>
                  <p className="truncate text-sm text-slate-500">{site.url}</p>
                </div>
                <SiteStatusBadge status={site.status} />
              </div>
              <p className="mt-4 text-xs text-slate-500">
                WordPress {site.wpVersion ?? '?'} · SEO: {site.seoPlugin ?? 'none detected'} · checked{' '}
                {timeAgo(site.lastCheckedAt)}
              </p>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
