'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useState } from 'react';
import { AuthShell } from '../../components/auth-form';
import { Button, ErrorText, Field, Input } from '../../components/ui';
import { authClient } from '../../lib/auth-client';

function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    params.get('error') ? 'This reset link is invalid or has expired.' : null,
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get('password'));
    if (newPassword !== String(form.get('confirm'))) {
      setError('The passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await authClient.resetPassword({ newPassword, token: token ?? '' });
    setBusy(false);
    if (result.error) setError(result.error.message ?? 'Something went wrong.');
    else router.replace('/sign-in');
  }

  return (
    <AuthShell
      title="Choose a new password"
      footer={
        <Link href="/forgot-password" className="font-medium text-brand-600">
          Request a new link
        </Link>
      }
    >
      {token ? (
        <form onSubmit={submit} className="space-y-4">
          <Field label="New password" hint="At least 8 characters.">
            <Input name="password" type="password" required minLength={8} autoComplete="new-password" />
          </Field>
          <Field label="Repeat it">
            <Input name="confirm" type="password" required minLength={8} autoComplete="new-password" />
          </Field>
          <ErrorText error={error} />
          <Button type="submit" busy={busy} className="w-full">
            Save password
          </Button>
        </form>
      ) : (
        <ErrorText error={error ?? 'This page needs the link from your reset email.'} />
      )}
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
