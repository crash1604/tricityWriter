import type { GenerationStatus, Site } from '../lib/api';
import { Badge } from './ui';

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
