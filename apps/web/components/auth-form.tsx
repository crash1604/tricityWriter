'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { authClient } from '../lib/auth-client';
import { Button, ErrorText, Field, Input } from './ui';

export function AuthForm({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? 'Something went wrong.');
      return;
    }
    router.replace('/sites');
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-lg font-bold text-white">
            T
          </div>
          <h1 className="text-xl font-semibold">
            {mode === 'sign-up' ? 'Create your account' : 'Sign in to TriCity Writer'}
          </h1>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-xl bg-white p-6 ring-1 ring-slate-200">
          {mode === 'sign-up' && (
            <Field label="Name">
              <Input name="name" required autoComplete="name" />
            </Field>
          )}
          <Field label="Email">
            <Input name="email" type="email" required autoComplete="email" />
          </Field>
          <Field label="Password" hint={mode === 'sign-up' ? 'At least 8 characters.' : undefined}>
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
        <p className="mt-4 text-center text-sm text-slate-500">
          {mode === 'sign-up' ? (
            <>
              Already have an account?{' '}
              <Link href="/sign-in" className="font-medium text-brand-600">
                Sign in
              </Link>
            </>
          ) : (
            <>
              New here?{' '}
              <Link href="/sign-up" className="font-medium text-brand-600">
                Create an account
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
