'use client';

import { useQuery } from '@tanstack/react-query';
import type { GenerationStatus, Site } from '../lib/api';
import { Badge } from './ui';

// The connector version this dashboard ships (written by scripts/build-plugin-zip.sh).
export function useLatestConnector(): string | null {
  const manifest = useQuery({
    queryKey: ['connector-manifest'],
    queryFn: async () => {
      const response = await fetch('/downloads/tricity-writer.json');
      return response.ok ? ((await response.json()) as { version: string }) : null;
    },
    staleTime: 60 * 60_000,
  });
  return manifest.data?.version ?? null;
}

function newer(latest: string, installed: string): boolean {
  const a = latest.split('.').map(Number);
  const b = installed.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

// Sites learn about connector updates through WordPress' own update screen; this nudges people there.
export function ConnectorUpdate({
  site,
  latest,
}: {
  site: Pick<Site, 'url' | 'pluginVersion'>;
  latest: string | null;
}) {
  if (!latest || !site.pluginVersion || !newer(latest, site.pluginVersion)) return null;
  return (
    <a
      href={`${site.url}/wp-admin/update-core.php`}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="text-xs font-medium text-amber-700 hover:underline"
    >
      Connector {latest} available: update it in WordPress
    </a>
  );
}

export function SiteStatusBadge({ status }: { status: Site['status'] }) {
  const map = {
    connected: ['green', 'Connected'],
    disconnected: ['red', 'Disconnected'],
    error: ['yellow', 'Unreachable'],
  } as const;
  const [tone, label] = map[status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function GenerationStatusBadge({ status, wpStatus }: { status: GenerationStatus; wpStatus?: string | null }) {
  const map = {
    queued: ['gray', 'Queued'],
    generating: ['blue', 'Writing…'],
    ready: ['yellow', 'Ready for review'],
    publishing: ['blue', 'Publishing…'],
    published: [
      'green',
      wpStatus === 'draft' ? 'Draft in WordPress' : wpStatus === 'future' ? 'Scheduled' : 'Published',
    ],
    failed: ['red', 'Failed'],
  } as const;
  const [tone, label] = map[status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return null;
  return <Badge tone={score >= 80 ? 'green' : score >= 60 ? 'yellow' : 'red'}>SEO {score}</Badge>;
}

export const isWorking = (status: GenerationStatus) =>
  status === 'queued' || status === 'generating' || status === 'publishing';

export function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 60) return 'just now';
  const units: [number, string][] = [
    [60, 'minute'],
    [3600, 'hour'],
    [86400, 'day'],
  ];
  for (let i = units.length - 1; i >= 0; i--) {
    const [size, unit] = units[i] as [number, string];
    if (seconds >= size) {
      const n = Math.floor(seconds / size);
      return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
    }
  }
  return 'just now';
}
