'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ArticleList } from '../../../components/article-list';
import { isWorking } from '../../../components/status';
import { Card, EmptyState, ErrorText, Loading, PageHeader, Select } from '../../../components/ui';
import { api, type GenerationSummary, type Site } from '../../../lib/api';

export default function ArticlesPage() {
  const [siteId, setSiteId] = useState('');
  const [source, setSource] = useState('');
  const sites = useQuery({ queryKey: ['sites'], queryFn: () => api<{ sites: Site[] }>('/sites') });
  const articles = useQuery({
    queryKey: ['generations', 'all', siteId, source],
    queryFn: () =>
      api<{ generations: GenerationSummary[] }>(
        `/generations?limit=100${siteId ? `&siteId=${siteId}` : ''}${source ? `&source=${source}` : ''}`,
      ),
    refetchInterval: (q) => (q.state.data?.generations.some((g) => isWorking(g.status)) ? 3000 : false),
  });

  return (
    <>
      <PageHeader
        title="Articles"
        description="Everything written by the wizard, auto-blogging and your AI assistants."
      />
      <Card
        actions={
          <>
            <Select value={siteId} onChange={(e) => setSiteId(e.target.value)} className="w-48">
              <option value="">All sites</option>
              {sites.data?.sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <Select value={source} onChange={(e) => setSource(e.target.value)} className="w-40">
              <option value="">All sources</option>
              <option value="wizard">Wizard</option>
              <option value="autoblog">Auto-blogging</option>
              <option value="mcp">AI assistant</option>
            </Select>
          </>
        }
        title="Recent"
      >
        {articles.isPending ? (
          <Loading />
        ) : articles.error ? (
          <ErrorText error={articles.error} />
        ) : articles.data.generations.length === 0 ? (
          <EmptyState title="No articles yet" />
        ) : (
          <ArticleList articles={articles.data.generations} />
        )}
      </Card>
    </>
  );
}
