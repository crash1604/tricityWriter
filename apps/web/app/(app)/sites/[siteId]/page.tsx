'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { ArticleList } from '../../../../components/article-list';
import { DEFAULT_OPTIONS, OptionsFields } from '../../../../components/options';
import {
  ConnectorUpdate,
  isWorking,
  SiteStatusBadge,
  timeAgo,
  useLatestConnector,
} from '../../../../components/status';
import {
  Badge,
  Button,
  Card,
  cx,
  EmptyState,
  ErrorText,
  Field,
  Input,
  Loading,
  PageHeader,
  Select,
  Textarea,
} from '../../../../components/ui';
import {
  type AutoblogProfile,
  type AutoblogState,
  api,
  type GenerationSummary,
  type Site,
  type SiteStatus,
  type WpPostSummary,
} from '../../../../lib/api';

const TABS = ['Overview', 'Posts', 'Auto-blogging', 'Settings'] as const;
type Tab = (typeof TABS)[number];

export default function SitePage() {
  const { siteId } = useParams<{ siteId: string }>();
  const [tab, setTab] = useState<Tab>('Overview');
  const site = useQuery({ queryKey: ['site', siteId], queryFn: () => api<{ site: Site }>(`/sites/${siteId}`) });

  if (site.isPending) return <Loading />;
  if (site.error) return <ErrorText error={site.error} />;
  const s = site.data.site;

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {s.name} <SiteStatusBadge status={s.status} />
          </span>
        }
        description={
          <a href={s.homeUrl ?? s.url} target="_blank" rel="noreferrer" className="hover:underline">
            {s.homeUrl ?? s.url}
          </a>
        }
        actions={
          <Link href={`/sites/${s.id}/write`}>
            <Button>Write an article</Button>
          </Link>
        }
      />
      <div className="mb-6 flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            type="button"
            key={t}
            onClick={() => setTab(t)}
            className={cx(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium',
              tab === t ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800',
            )}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'Overview' && <Overview site={s} />}
      {tab === 'Posts' && <Posts site={s} />}
      {tab === 'Auto-blogging' && <Autoblog site={s} />}
      {tab === 'Settings' && <SiteSettings site={s} />}
    </>
  );
}

function Overview({ site }: { site: Site }) {
  const queryClient = useQueryClient();
  const latestConnector = useLatestConnector();
  const check = useMutation({
    mutationFn: () => api<{ site: Site; status: SiteStatus | null }>(`/sites/${site.id}/check`, { method: 'POST' }),
    onSuccess: (data) => queryClient.setQueryData(['site', site.id], { site: data.site }),
  });
  const articles = useQuery({
    queryKey: ['generations', site.id],
    queryFn: () => api<{ generations: GenerationSummary[] }>(`/generations?siteId=${site.id}&limit=20`),
    refetchInterval: (q) => (q.state.data?.generations.some((g) => isWorking(g.status)) ? 3000 : false),
  });
  const caps = check.data?.status?.capabilities;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <Card
        title="Connection"
        actions={
          <Button variant="secondary" busy={check.isPending} onClick={() => check.mutate()}>
            Check now
          </Button>
        }
      >
        <dl className="space-y-2 text-sm">
          <Row label="Status">
            <SiteStatusBadge status={site.status} />
          </Row>
          {site.statusMessage && <p className="text-xs text-red-600">{site.statusMessage}</p>}
          <Row label="WordPress">{site.wpVersion ?? '—'}</Row>
          <Row label="Connector">
            <span className="flex flex-col items-end gap-0.5">
              {site.pluginVersion ?? '—'}
              <ConnectorUpdate site={site} latest={latestConnector} />
            </span>
          </Row>
          <Row label="SEO plugin">{site.seoPlugin ?? 'None (we print meta tags ourselves)'}</Row>
          <Row label="Last checked">{timeAgo(site.lastCheckedAt)}</Row>
          {check.data?.status && <Row label="Acting as">{check.data.status.user.display_name}</Row>}
        </dl>
        {caps && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {Object.entries(caps).map(([cap, ok]) => (
              <Badge key={cap} tone={ok ? 'green' : 'red'}>
                {cap.replace(/_/g, ' ')}
              </Badge>
            ))}
          </div>
        )}
        <ErrorText error={check.error} />
      </Card>

      <Card title="Recent articles" className="lg:col-span-2">
        {articles.isPending ? (
          <Loading />
        ) : (articles.data?.generations.length ?? 0) === 0 ? (
          <EmptyState title="Nothing written yet">
            <Link className="text-brand-600" href={`/sites/${site.id}/write`}>
              Write your first article
            </Link>
          </EmptyState>
        ) : (
          <ArticleList articles={articles.data?.generations ?? []} />
        )}
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function Posts({ site }: { site: Site }) {
  const [type, setType] = useState<'post' | 'page'>('post');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const posts = useQuery({
    queryKey: ['wp-posts', site.id, type, search, page],
    queryFn: () =>
      api<{ items: WpPostSummary[]; total: number; pages: number }>(
        `/sites/${site.id}/posts?type=${type}&page=${page}&search=${encodeURIComponent(search)}`,
      ),
  });

  return (
    <Card
      title={`WordPress ${type === 'post' ? 'posts' : 'pages'}`}
      actions={
        <>
          <Input
            placeholder="Search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-48"
          />
          <Select
            value={type}
            onChange={(e) => {
              setType(e.target.value as 'post' | 'page');
              setPage(1);
            }}
            className="w-28"
          >
            <option value="post">Posts</option>
            <option value="page">Pages</option>
          </Select>
        </>
      }
    >
      {posts.isPending ? (
        <Loading />
      ) : posts.error ? (
        <ErrorText error={posts.error} />
      ) : posts.data.items.length === 0 ? (
        <EmptyState title="Nothing found" />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="pb-2 font-medium">Title</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Words</th>
                  <th className="pb-2 font-medium">Image</th>
                  <th className="pb-2 font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {posts.data.items.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2 pr-4">
                      <a href={p.link} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                        {p.title || '(no title)'}
                      </a>
                    </td>
                    <td className="py-2">
                      <Badge tone={p.status === 'publish' ? 'green' : 'gray'}>{p.status}</Badge>
                    </td>
                    <td className={cx('py-2', p.word_count < 300 && 'text-amber-700')}>{p.word_count}</td>
                    <td className="py-2">
                      {p.has_featured_image ? '✓' : <span className="text-amber-700">missing</span>}
                    </td>
                    <td className="py-2 text-slate-500">{new Date(p.date_gmt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
            <span>{posts.data.total} total</span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <Button variant="secondary" disabled={page >= posts.data.pages} onClick={() => setPage(page + 1)}>
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

const SCHEDULES = [
  { label: 'Every day at 9:00', value: '0 9 * * *' },
  { label: 'Weekdays at 9:00', value: '0 9 * * 1-5' },
  { label: 'Mon, Wed, Fri at 9:00', value: '0 9 * * 1,3,5' },
  { label: 'Every Monday at 9:00', value: '0 9 * * 1' },
  { label: 'Twice a day (9:00, 17:00)', value: '0 9,17 * * *' },
];

function Autoblog({ site }: { site: Site }) {
  const queryClient = useQueryClient();
  const key = ['autoblog', site.id];
  const state = useQuery({
    queryKey: key,
    queryFn: () => api<AutoblogState>(`/sites/${site.id}/autoblog`),
    refetchInterval: (q) => (q.state.data?.history.some((g) => isWorking(g.status)) ? 3000 : false),
  });
  const [profile, setProfile] = useState<AutoblogProfile | null>(null);
  const [topics, setTopics] = useState('');

  useEffect(() => {
    if (state.data && !profile) {
      const loaded = state.data.profile;
      const isNew = loaded.timezone === 'UTC' && !loaded.enabled;
      setProfile({
        ...loaded,
        settings: { ...DEFAULT_OPTIONS, ...loaded.settings },
        timezone: isNew ? Intl.DateTimeFormat().resolvedOptions().timeZone : loaded.timezone,
      });
    }
  }, [state.data, profile]);

  const save = useMutation({
    mutationFn: (p: AutoblogProfile) => api<AutoblogState>(`/sites/${site.id}/autoblog`, { method: 'PUT', body: p }),
    onSuccess: (data) => queryClient.setQueryData(key, data),
  });
  const addTopics = useMutation({
    mutationFn: (list: string[]) =>
      api(`/sites/${site.id}/autoblog/topics`, { method: 'POST', body: { topics: list } }),
    onSuccess: () => {
      setTopics('');
      queryClient.invalidateQueries({ queryKey: key });
    },
  });
  const removeTopic = useMutation({
    mutationFn: (id: string) => api(`/autoblog/topics/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  const runNow = useMutation({
    mutationFn: () => api(`/sites/${site.id}/autoblog/run`, { method: 'POST' }),
    onSuccess: () => setTimeout(() => queryClient.invalidateQueries({ queryKey: key }), 1500),
  });

  if (state.isPending || !profile) return <Loading />;
  if (state.error) return <ErrorText error={state.error} />;
  const set = <K extends keyof AutoblogProfile>(k: K, v: AutoblogProfile[K]) => setProfile({ ...profile, [k]: v });

  function submitTopics(event: FormEvent) {
    event.preventDefault();
    const list = topics
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean);
    if (list.length) addTopics.mutate(list);
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      <div className="space-y-6 lg:col-span-3">
        <Card
          title="Schedule and publishing"
          actions={
            <Button busy={save.isPending} onClick={() => save.mutate(profile)}>
              Save
            </Button>
          }
        >
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <Field label="Auto-blogging">
              <Select value={profile.enabled ? 'on' : 'off'} onChange={(e) => set('enabled', e.target.value === 'on')}>
                <option value="off">Off</option>
                <option value="on">On</option>
              </Select>
            </Field>
            <Field label="When a run finishes">
              <Select value={profile.mode} onChange={(e) => set('mode', e.target.value as AutoblogProfile['mode'])}>
                <option value="assist">Save as draft for review</option>
                <option value="guarded">Publish if the SEO score is high enough</option>
                <option value="autopilot">Always publish</option>
              </Select>
            </Field>
            {profile.mode === 'guarded' && (
              <Field label="Minimum SEO score" hint="Below this, the post is saved as a draft.">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={profile.threshold}
                  onChange={(e) => set('threshold', Number(e.target.value))}
                />
              </Field>
            )}
            <Field label="Schedule" hint="Cron pattern; pick a preset or write your own.">
              <Select
                value={SCHEDULES.some((s) => s.value === profile.schedule) ? profile.schedule : 'custom'}
                onChange={(e) => e.target.value !== 'custom' && set('schedule', e.target.value)}
              >
                {SCHEDULES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
                <option value="custom">Custom…</option>
              </Select>
              <Input
                className="mt-2 font-mono"
                value={profile.schedule}
                onChange={(e) => set('schedule', e.target.value)}
              />
            </Field>
            <Field label="Time zone">
              <Input value={profile.timezone} onChange={(e) => set('timezone', e.target.value)} />
            </Field>
          </div>
          <hr className="my-6 border-slate-100" />
          <OptionsFields value={profile.settings} onChange={(settings) => set('settings', settings)} />
          <div className="mt-4">
            <ErrorText error={save.error} />
            {save.isSuccess && <p className="text-sm text-emerald-700">Saved.</p>}
          </div>
        </Card>

        <Card title="Recent runs">
          {state.data.history.length === 0 ? (
            <EmptyState title="No runs yet" />
          ) : (
            <ArticleList articles={state.data.history.map((g) => ({ ...g, title: g.output?.title ?? null }))} />
          )}
        </Card>
      </div>

      <Card
        title={`Topic queue (${state.data.queue.length})`}
        className="lg:col-span-2"
        actions={
          <Button
            variant="secondary"
            busy={runNow.isPending}
            disabled={state.data.queue.length === 0}
            onClick={() => runNow.mutate()}
          >
            Run now
          </Button>
        }
      >
        <form onSubmit={submitTopics} className="mb-4 space-y-2">
          <Textarea
            placeholder={'One topic per line, e.g.\nHow to repot a monstera\nBest indoor plants for low light'}
            value={topics}
            onChange={(e) => setTopics(e.target.value)}
          />
          <Button type="submit" variant="secondary" busy={addTopics.isPending}>
            Add topics
          </Button>
          <ErrorText error={addTopics.error ?? runNow.error} />
          {runNow.isSuccess && <p className="text-sm text-emerald-700">Run started.</p>}
        </form>
        {state.data.queue.length === 0 ? (
          <EmptyState title="The queue is empty">Each run writes about the oldest topic here.</EmptyState>
        ) : (
          <ol className="divide-y divide-slate-100 text-sm">
            {state.data.queue.map((t, i) => (
              <li key={t.id} className="flex items-center justify-between gap-2 py-2">
                <span>
                  <span className="mr-2 text-slate-400">{i + 1}.</span>
                  {t.topic}
                </span>
                <button
                  type="button"
                  className="text-xs text-slate-400 hover:text-red-600"
                  onClick={() => removeTopic.mutate(t.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

function SiteSettings({ site }: { site: Site }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [form, setForm] = useState({
    name: site.name,
    contentPrompt: site.contentPrompt,
    designPrompt: site.designPrompt,
  });
  const save = useMutation({
    mutationFn: () => api<{ site: Site }>(`/sites/${site.id}`, { method: 'PATCH', body: form }),
    onSuccess: (data) => queryClient.setQueryData(['site', site.id], data),
  });
  const remove = useMutation({
    mutationFn: () => api(`/sites/${site.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      router.push('/sites');
    },
  });
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="space-y-6">
      <Card
        title="Site settings"
        actions={
          <Button busy={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        }
      >
        <div className="space-y-5">
          <Field label="Name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field
            label="Global content instructions"
            hint="Applied to every article for this site: audience, voice, facts to respect, links you want used."
          >
            <Textarea
              rows={4}
              value={form.contentPrompt}
              onChange={(e) => setForm({ ...form, contentPrompt: e.target.value })}
            />
          </Field>
          <Field
            label="Global design instructions"
            hint="Applied to every article: brand colors, which patterns to use or avoid."
          >
            <Textarea
              rows={3}
              value={form.designPrompt}
              onChange={(e) => setForm({ ...form, designPrompt: e.target.value })}
            />
          </Field>
          <ErrorText error={save.error} />
          {save.isSuccess && <p className="text-sm text-emerald-700">Saved.</p>}
        </div>
      </Card>
      <Card title="Disconnect">
        <p className="mb-4 text-sm text-slate-600">
          Removes the site and its articles and auto-blogging settings here, and revokes our connection in WordPress.
          Posts already in WordPress are not touched.
        </p>
        {confirming ? (
          <div className="flex gap-2">
            <Button variant="danger" busy={remove.isPending} onClick={() => remove.mutate()}>
              Yes, disconnect {site.name}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Disconnect site
          </Button>
        )}
        <ErrorText error={remove.error} />
      </Card>
    </div>
  );
}
