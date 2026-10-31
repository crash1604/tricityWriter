'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { AuthShell } from '../../../components/auth-form';
import { Button, ErrorText, Loading } from '../../../components/ui';
import { authClient } from '../../../lib/auth-client';

export default function AcceptInvitePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = authClient.useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = encodeURIComponent(`/accept-invite/${id}`);

  async function accept() {
    setBusy(true);
    setError(null);
    const result = await authClient.organization.acceptInvitation({ invitationId: id });
    if (result.error) {
      setBusy(false);
      setError(result.error.message ?? 'This invitation is invalid, expired, or meant for another email address.');
      return;
    }
    const organizationId = (result.data as { member?: { organizationId?: string } } | null)?.member?.organizationId;
    if (organizationId) await authClient.organization.setActive({ organizationId });
    await queryClient.invalidateQueries();
    router.replace('/sites');
  }

  if (session.isPending) return <Loading />;

  return (
    <AuthShell title="Join a workspace">
      {session.data ? (
        <>
          <p className="text-sm text-slate-600">
            You're signed in as <strong>{session.data.user.email}</strong>. The invitation must be for this address.
          </p>
          <ErrorText error={error} />
          <Button busy={busy} className="w-full" onClick={accept}>
            Accept invitation
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm text-slate-600">
            You've been invited to a TriCity Writer workspace. Sign in, or create an account with the email address the
            invitation was sent to.
          </p>
          <div className="flex gap-2">
            <Link href={`/sign-in?next=${next}`} className="flex-1">
              <Button className="w-full">Sign in</Button>
            </Link>
            <Link href={`/sign-up?next=${next}`} className="flex-1">
              <Button variant="secondary" className="w-full">
                Create account
              </Button>
            </Link>
          </div>
        </>
      )}
    </AuthShell>
  );
}
