'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { GenerationStatusBadge, isWorking, ScoreBadge } from '../../../../components/status';
import {
  Badge,
  Button,
  Card,
  cx,
  ErrorText,
  Field,
  Input,
  Loading,
  PageHeader,
  Select,
  Spinner,
  Textarea,
} from '../../../../components/ui';
import { api, type Generation, type GenerationOutput } from '../../../../lib/api';

type Draft = Pick<GenerationOutput, 'title' | 'metaTitle' | 'metaDescription' | 'focusKeyword' | 'excerpt' | 'html'> & {
  categories: string;
  tags: string;
};

export default function ArticlePage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const key = ['generation', id];
  const query = useQuery({
    queryKey: key,
    queryFn: () => api<{ generation: Generation }>(`/generations/${id}`),
    refetchInterval: (q) => (q.state.data && isWorking(q.state.data.generation.status) ? 2000 : false),
  });
  const setGeneration = (data: { generation: Generation }) => queryClient.setQueryData(key, data);

  const regenerate = useMutation({
    mutationFn: () => api<{ generation: Generation }>(`/generations/${id}/regenerate`, { method: 'POST' }),
    onSuccess: setGeneration,
  });

  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorText error={query.error} />;
  const g = query.data.generation;

  return (
    <>
      <PageHeader
        title={g.output?.title ?? g.topic}
        description={
          <span className="flex items-center gap-2">
            <GenerationStatusBadge status={g.status} wpStatus={g.wpPostStatus} />
            <ScoreBadge score={g.seoScore} />
            <Link href={`/sites/${g.siteId}`} className="hover:underline">
              Back to site
            </Link>
          </span>
        }
        actions={
          (g.status === 'ready' || g.status === 'published' || g.status === 'failed') && (
            <Button variant="secondary" busy={regenerate.isPending} onClick={() => regenerate.mutate()}>
              Regenerate
            </Button>
          )
        }
      />
      <ErrorText error={regenerate.error} />

      {(g.status === 'queued' || g.status === 'generating') && (
        <Card>
          <div className="flex items-center gap-4 py-6">
            <Spinner className="h-6 w-6 text-brand-600" />
            <div>
              <p className="font-medium">
                {g.status === 'queued' ? 'Waiting for a writer…' : 'Writing the article and creating images…'}
              </p>
              <p className="text-sm text-slate-500">
                This usually takes one to three minutes. You can leave this page.
              </p>
              {g.error && <p className="mt-1 text-sm text-amber-700">{g.error}</p>}
            </div>
          </div>
        </Card>
      )}

      {g.status === 'failed' && (
        <Card>
          <p className="font-medium text-red-700">Generation failed</p>
          <p className="mt-1 text-sm text-slate-600">{g.error}</p>
        </Card>
      )}

      {g.output && (g.status === 'ready' || g.status === 'published' || g.status === 'publishing') && (
        <Review generation={g} output={g.output} onChange={setGeneration} />
      )}
    </>
  );
}

function toDraft(o: GenerationOutput): Draft {
  return {
    title: o.title,
    metaTitle: o.metaTitle,
    metaDescription: o.metaDescription,
    focusKeyword: o.focusKeyword,
    excerpt: o.excerpt,
    html: o.html,
    categories: o.categories.join(', '),
    tags: o.tags.join(', '),
  };
}

function Review({
  generation: g,
  output,
  onChange,
}: {
  generation: Generation;
  output: GenerationOutput;
  onChange: (data: { generation: Generation }) => void;
}) {
  const [draft, setDraft] = useState<Draft>(toDraft(output));
  const [editingHtml, setEditingHtml] = useState(false);
  const [publishAs, setPublishAs] = useState<'draft' | 'publish' | 'future'>('draft');
  const [scheduledAt, setScheduledAt] = useState('');
  useEffect(() => setDraft(toDraft(output)), [output]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(output));
  const split = (s: string) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);

  const save = useMutation({
    mutationFn: () =>
      api<{ generation: Generation }>(`/generations/${g.id}`, {
        method: 'PATCH',
        body: { ...draft, categories: split(draft.categories), tags: split(draft.tags) },
      }),
    onSuccess: onChange,
  });
  const publish = useMutation({
    mutationFn: async () => {
      if (dirty) onChange(await save.mutateAsync());
      return api<{ generation: Generation }>(`/generations/${g.id}/publish`, {
        method: 'POST',
        body: {
          status: publishAs,
          ...(publishAs === 'future' && scheduledAt && { scheduledAt: new Date(scheduledAt).toISOString() }),
        },
      });
    },
    onSuccess: onChange,
  });

  const set = (k: keyof Draft, v: string) => setDraft({ ...draft, [k]: v });
  const srcDoc = previewDocument(draft.title, output.featuredImageUrl, dirty ? draft.html : output.previewHtml);

  return (
    <div className="grid gap-6 xl:grid-cols-5">
      <div className="space-y-4 xl:col-span-3">
        <Card
          title="Preview"
          actions={
            <Button variant="ghost" onClick={() => setEditingHtml(!editingHtml)}>
              {editingHtml ? 'Show preview' : 'Edit HTML'}
            </Button>
          }
        >
          {editingHtml ? (
            <Textarea
              className="min-h-[70vh] font-mono text-xs"
              value={draft.html}
              onChange={(e) => set('html', e.target.value)}
            />
          ) : (
            <iframe
              title="Article preview"
              srcDoc={srcDoc}
              // No scripts can run; same-origin lets image requests carry the session cookie.
              sandbox="allow-same-origin allow-popups"
              className="h-[70vh] w-full rounded-lg ring-1 ring-slate-200"
            />
          )}
          {dirty && editingHtml && (
            <p className="mt-2 text-xs text-slate-500">Unsaved HTML shows images only after saving.</p>
          )}
        </Card>
      </div>

      <div className="space-y-4 xl:col-span-2">
        <Card title="Publish">
          {g.status === 'publishing' ? (
            <p className="flex items-center gap-2 text-sm text-slate-600">
              <Spinner className="h-4 w-4" /> Sending to WordPress…
            </p>
          ) : (
            <div className="space-y-3">
              {g.wpPostUrl && (
                <p className="text-sm">
                  In WordPress as <Badge tone="green">{g.wpPostStatus}</Badge>{' '}
                  <a
                    href={g.wpPostUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-brand-600 hover:underline"
                  >
                    Open post ↗
                  </a>
                </p>
              )}
              <Field label={g.wpPostId ? 'Update the WordPress post as' : 'Send to WordPress as'}>
                <Select value={publishAs} onChange={(e) => setPublishAs(e.target.value as typeof publishAs)}>
                  <option value="draft">Draft</option>
                  <option value="publish">Published</option>
                  <option value="future">Scheduled</option>
                </Select>
              </Field>
              {publishAs === 'future' && (
                <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
              )}
              <Button className="w-full" busy={publish.isPending} onClick={() => publish.mutate()}>
                {g.wpPostId ? 'Update in WordPress' : 'Send to WordPress'}
              </Button>
              <ErrorText error={publish.error} />
              {g.error && <ErrorText error={g.error} />}
            </div>
          )}
        </Card>

        {output.warnings.length > 0 && (
          <div className="space-y-1 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            {output.warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </div>
        )}

        <Card
          title={
            <span className="flex items-center gap-2">
              SEO <ScoreBadge score={output.seo.score} />
            </span>
          }
        >
          <ul className="space-y-1.5 text-sm">
            {output.seo.checks.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-3">
                <span className={cx(c.passed ? 'text-slate-700' : 'text-red-700')}>
                  {c.passed ? '✓' : '✗'} {c.label}
                </span>
                {c.detail && <span className="shrink-0 text-xs text-slate-400">{c.detail}</span>}
              </li>
            ))}
          </ul>
        </Card>

        <Card
          title="Details"
          actions={
            <Button variant="secondary" disabled={!dirty} busy={save.isPending} onClick={() => save.mutate()}>
              Save changes
            </Button>
          }
        >
          <div className="space-y-4">
            <Field label="Title">
              <Input value={draft.title} onChange={(e) => set('title', e.target.value)} />
            </Field>
            <Field label="SEO title" hint={`${draft.metaTitle.length} characters (aim for 30–60)`}>
              <Input value={draft.metaTitle} onChange={(e) => set('metaTitle', e.target.value)} />
            </Field>
            <Field label="Meta description" hint={`${draft.metaDescription.length} characters (aim for 120–160)`}>
              <Textarea
                rows={3}
                value={draft.metaDescription}
                onChange={(e) => set('metaDescription', e.target.value)}
              />
            </Field>
            <Field label="Focus keyword">
              <Input value={draft.focusKeyword} onChange={(e) => set('focusKeyword', e.target.value)} />
            </Field>
            <Field label="Excerpt">
              <Textarea rows={2} value={draft.excerpt} onChange={(e) => set('excerpt', e.target.value)} />
            </Field>
            {g.input.postType === 'post' && (
              <>
                <Field label="Categories" hint="Comma-separated. Existing categories are reused.">
                  <Input value={draft.categories} onChange={(e) => set('categories', e.target.value)} />
                </Field>
                <Field label="Tags" hint="Comma-separated.">
                  <Input value={draft.tags} onChange={(e) => set('tags', e.target.value)} />
                </Field>
              </>
            )}
            <ErrorText error={save.error} />
          </div>
        </Card>
        <p className="text-xs text-slate-400">
          Written by {output.textModel}
          {output.imageModel ? ` · images by ${output.imageModel}` : ''}
        </p>
      </div>
    </div>
  );
}

// Approximates a theme so the inline-styled HTML can be judged before publishing.
function previewDocument(title: string, featured: string | null, html: string): string {
  const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>
body{font-family:Georgia,'Times New Roman',serif;max-width:760px;margin:32px auto;padding:0 20px;line-height:1.7;color:#1f2937;font-size:17px}
h1,h2,h3{font-family:system-ui,sans-serif;line-height:1.25;color:#111827}h1{font-size:2.1rem}
img{max-width:100%;height:auto;border-radius:8px}figure{margin:28px 0}table{max-width:100%}a{color:#4f46e5}
.featured{width:100%;aspect-ratio:3/2;object-fit:cover;margin-bottom:8px}
</style></head><body>${featured ? `<img class="featured" src="${featured}" alt="">` : ''}<h1>${escapeHtml(title)}</h1>${html}</body></html>`;
}
