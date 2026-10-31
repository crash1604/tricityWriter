'use client';

import { useQuery } from '@tanstack/react-query';
import { Suspense, useState } from 'react';
import { AuthShell } from '../../../components/auth-form';
import { Button, ErrorText, Loading } from '../../../components/ui';
import { api, type Me } from '../../../lib/api';
import { authClient } from '../../../lib/auth-client';

// Users in several workspaces choose which one an AI assistant may act in. The token issued afterwards
// is bound to that workspace.
function ChooseWorkspace() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me') });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(organizationId: string) {
    setBusy(organizationId);
    setError(null);
    await authClient.organization.setActive({ organizationId });
    const result = await authClient.oauth2.continue({ postLogin: true });
    const data = result.data as { url?: string } | null;
    if (result.error || !data?.url) {
      setBusy(null);
      setError(result.error?.message ?? 'The authorization request has expired. Start again from your AI assistant.');
      return;
    }
    window.location.href = data.url;
  }

  if (me.isPending) return <Loading />;
  return (
    <AuthShell title="Choose a workspace">
      <p className="text-sm text-slate-600">Which workspace should the AI assistant work in?</p>
      <div className="space-y-2">
        {me.data?.organizations.map((o) => (
          <Button
            key={o.id}
            variant="secondary"
            className="w-full justify-start"
            busy={busy === o.id}
            disabled={busy !== null}
            onClick={() => choose(o.id)}
          >
            {o.name}
          </Button>
        ))}
      </div>
      <ErrorText error={error ?? me.error} />
    </AuthShell>
  );
}

export default function WorkspacePage() {
  return (
    <Suspense>
      <ChooseWorkspace />
    </Suspense>
  );
}
