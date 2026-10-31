'use client';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AuthShell } from '../../../components/auth-form';
import { Button, ErrorText, Loading } from '../../../components/ui';
import { api, type Me } from '../../../lib/api';
import { authClient } from '../../../lib/auth-client';

// Better Auth sends MCP clients here during authorization. The signed request in the query string is
// attached to the consent call by oauthProviderClient.
function Consent() {
  const params = useSearchParams();
  const session = authClient.useSession();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me'), enabled: !!session.data });
  const client = useQuery({
    queryKey: ['oauth-client', params.get('client_id')],
    queryFn: async () => {
      const result = await authClient.oauth2.publicClient({ query: { client_id: params.get('client_id') ?? '' } });
      return (result.data ?? null) as { client_name?: string; client_uri?: string } | null;
    },
    enabled: !!params.get('client_id'),
  });
  const [busy, setBusy] = useState<'accept' | 'deny' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(accept: boolean) {
    setBusy(accept ? 'accept' : 'deny');
    setError(null);
    const result = await authClient.oauth2.consent({ accept });
    const data = result.data as { url?: string } | null;
    if (result.error || !data?.url) {
      setBusy(null);
      setError(result.error?.message ?? 'The authorization request has expired. Start again from your AI assistant.');
      return;
    }
    window.location.href = data.url;
  }

  if (session.isPending || me.isPending) return <Loading />;
  const workspace = me.data?.organizations.find((o) => o.id === me.data?.organizationId)?.name;
  const name = client.data?.client_name ?? 'An AI assistant';

  return (
    <AuthShell title="Allow access?">
      <p className="text-sm text-slate-700">
        <strong>{name}</strong> wants to use TriCity Writer as <strong>{session.data?.user.email}</strong> in the{' '}
        <strong>{workspace ?? 'current'}</strong> workspace.
      </p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
        <li>See and manage the workspace's connected WordPress sites</li>
        <li>Create, edit, schedule and publish posts and pages</li>
        <li>Generate articles and images with the workspace's AI models</li>
      </ul>
      <p className="text-xs text-slate-500">You can revoke access at any time under Settings → Connected apps.</p>
      <ErrorText error={error} />
      <div className="flex gap-2">
        <Button className="flex-1" busy={busy === 'accept'} disabled={busy !== null} onClick={() => decide(true)}>
          Allow
        </Button>
        <Button
          variant="secondary"
          className="flex-1"
          busy={busy === 'deny'}
          disabled={busy !== null}
          onClick={() => decide(false)}
        >
          Deny
        </Button>
      </div>
    </AuthShell>
  );
}

export default function ConsentPage() {
  return (
    <Suspense>
      <Consent />
    </Suspense>
  );
}
