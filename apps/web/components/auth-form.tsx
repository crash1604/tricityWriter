'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, type ReactNode, useState } from 'react';
import { authClient } from '../lib/auth-client';
import { Button, ErrorText, Field, Input } from './ui';

// Only same-site paths, so a crafted link can't send users elsewhere after signing in.
export function safeNext(value: string | null): string | null {
  return value?.startsWith('/') && !value.startsWith('//') ? value : null;
}

export function AuthShell({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-lg font-bold text-white">
            T
          </div>
          <h1 className="text-xl font-semibold">{title}</h1>
        </div>
        <div className="space-y-4 rounded-xl bg-white p-6 ring-1 ring-slate-200">{children}</div>
        {footer && <p className="mt-4 text-center text-sm text-slate-500">{footer}</p>}
      </div>
    </div>
  );
}

export function AuthForm({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Keeps OAuth (MCP sign-in) and invitation context when switching between sign-in and sign-up.
  const query = params.toString() ? `?${params.toString()}` : '';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email'));
    const password = String(form.get('password'));
    setBusy(true);
    setError(null);
    const result =
      mode === 'sign-up'
        ? await authClient.signUp.email({ email, password, name: String(form.get('name')) })
        : await authClient.signIn.email({ email, password });
    if (result.error) {
      setBusy(false);
      setError(result.error.message ?? 'Something went wrong.');
      return;
    }
    // During an MCP sign-in the server answers with the next OAuth step; the auth client follows it.
    const data = result.data as { redirect?: boolean; url?: string } | null;
    if (data?.redirect && data.url) return;
    router.replace(safeNext(params.get('next')) ?? '/sites');
  }

  return (
    <AuthShell
      title={mode === 'sign-up' ? 'Create your account' : 'Sign in to TriCity Writer'}
      footer={
        mode === 'sign-up' ? (
          <>
            Already have an account?{' '}
            <Link href={`/sign-in${query}`} className="font-medium text-brand-600">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New here?{' '}
            <Link href={`/sign-up${query}`} className="font-medium text-brand-600">
              Create an account
            </Link>
          </>
        )
      }
    >
      {params.get('sig') && (
        <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">
          An AI assistant wants to connect to your TriCity Writer workspace. Sign in to continue.
        </p>
      )}
      <form onSubmit={submit} className="space-y-4">
        {mode === 'sign-up' && (
          <Field label="Name">
            <Input name="name" required autoComplete="name" />
          </Field>
        )}
        <Field label="Email">
          <Input name="email" type="email" required autoComplete="email" defaultValue={params.get('email') ?? ''} />
        </Field>
        <Field
          label="Password"
          hint={
            mode === 'sign-up' ? (
              'At least 8 characters.'
            ) : (
              <Link href="/forgot-password" className="text-brand-600">
                Forgot your password?
              </Link>
            )
          }
        >
          <Input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
          />
        </Field>
        <ErrorText error={error} />
        <Button type="submit" busy={busy} className="w-full">
          {mode === 'sign-up' ? 'Create account' : 'Sign in'}
        </Button>
      </form>
    </AuthShell>
  );
}
