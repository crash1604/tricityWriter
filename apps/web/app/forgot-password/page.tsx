'use client';

import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { AuthShell } from '../../components/auth-form';
import { Button, ErrorText, Field, Input } from '../../components/ui';
import { authClient } from '../../lib/auth-client';

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await authClient.requestPasswordReset({
      email: String(new FormData(event.currentTarget).get('email')),
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (result.error) setError(result.error.message ?? 'Something went wrong.');
    else setSent(true);
  }

  return (
    <AuthShell
      title="Reset your password"
      footer={
        <Link href="/sign-in" className="font-medium text-brand-600">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <p className="text-sm text-slate-600">
          If an account exists for that address, a reset link is on its way. If this server has no email provider
          configured, ask your administrator for the link: it is written to the server log.
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email">
            <Input name="email" type="email" required autoComplete="email" />
          </Field>
          <ErrorText error={error} />
          <Button type="submit" busy={busy} className="w-full">
            Send reset link
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
