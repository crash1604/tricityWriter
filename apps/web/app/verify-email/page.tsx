'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { AuthShell, safeNext } from '../../components/auth-form';
import { Button, Loading } from '../../components/ui';
import { authClient } from '../../lib/auth-client';

// Where email confirmation links land. On success the server has already signed the user in.
function VerifyEmail() {
  const params = useSearchParams();
  const router = useRouter();
  const session = authClient.useSession();
  const failed = params.get('error');
  const next = safeNext(params.get('next')) ?? '/sites';

  useEffect(() => {
    if (failed || !session.data) return;
    const timer = setTimeout(() => router.replace(next), 1500);
    return () => clearTimeout(timer);
  }, [failed, session.data, router, next]);

  if (failed) {
    return (
      <AuthShell title="This link has expired">
        <p className="text-sm text-slate-600">
          The confirmation link is invalid or too old. Sign in with your email and password and we'll send you a new
          one.
        </p>
        <Link href="/sign-in" className="block">
          <Button className="w-full">Sign in</Button>
        </Link>
      </AuthShell>
    );
  }
  if (session.isPending) return <Loading />;

  return (
    <AuthShell title="Email confirmed">
      <p className="text-sm text-slate-600">
        {session.data ? (
          <>
            Thanks, <strong>{session.data.user.email}</strong> is confirmed. Taking you to your workspace…
          </>
        ) : (
          'Your email address is confirmed. Sign in to continue.'
        )}
      </p>
      <Link href={session.data ? next : `/sign-in?next=${encodeURIComponent(next)}`} className="block">
        <Button className="w-full">{session.data ? 'Continue' : 'Sign in'}</Button>
      </Link>
    </AuthShell>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmail />
    </Suspense>
  );
}
