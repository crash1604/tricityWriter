'use client';

import Link from 'next/link';
import type { GenerationSummary } from '../lib/api';
import { GenerationStatusBadge, ScoreBadge, timeAgo } from './status';

export function ArticleList({ articles }: { articles: GenerationSummary[] }) {
  return (
    <ul className="divide-y divide-slate-100">
      {articles.map((g) => (
        <li key={g.id}>
          <Link href={`/articles/${g.id}`} className="flex items-center justify-between gap-4 py-3 hover:bg-slate-50">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{g.title ?? g.topic}</p>
              <p className="text-xs text-slate-500">
                {g.source === 'autoblog' ? 'Auto-blog' : g.source === 'mcp' ? 'AI assistant' : 'Wizard'} ·{' '}
                {timeAgo(g.createdAt)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <ScoreBadge score={g.seoScore} />
              <GenerationStatusBadge status={g.status} wpStatus={g.wpPostStatus} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
