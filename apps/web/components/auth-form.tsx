'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, type ReactNode, useState } from 'react';
import { publicConfig } from '../lib/api';
import { authClient } from '../lib/auth-client';
import { Button, ErrorText, Field, Input } from './ui';

// Only same-site paths, so a crafted link can't send users elsewhere after signing in. Browsers read
// "/\\evil.com" like "//evil.com", so backslashes and control characters are refused outright, and the
// path must resolve to this origin.
export function safeNext(value: string | null): string | null {
  if (!value?.startsWith('/') || value.startsWith('//')) return null;
  if ([...value].some((c) => c === '\\' || c.charCodeAt(0) < 32)) return null;
  try {
    return new URL(value, 'https://same-origin.invalid').origin === 'https://same-origin.invalid' ? value : null;
  } catch {
    return null;
  }
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

// Where an email confirmation link lands, carrying the page the user was heading to.
export function verifyCallback(next: string | null): string {
  return `/verify-email${next ? `?next=${encodeURIComponent(next)}` : ''}`;
}

// Shown after sign-up (or an unconfirmed sign-in) when the server requires a confirmed email.
function CheckInbox({
  email,
  callbackURL,
  reason,
}: {
  email: string;
  callbackURL: string;
  reason: 'new' | 'unconfirmed';
}) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  async function resend() {
    setState('sending');
    const result = await authClient.sendVerificationEmail({ email, callbackURL });
    setState(result.error ? 'failed' : 'sent');
  }

  return (
    <AuthShell
      title="Check your inbox"
      footer={
        <Link href="/sign-in" className="font-medium text-brand-600">
          Back to sign in
        </Link>
      }
    >
      <p className="text-sm text-slate-600">
        {reason === 'new' ? 'Your account is almost ready. ' : 'Confirm your email address before signing in. '}
        We sent a confirmation link to <strong>{email}</strong>. Open it to continue; it works for 24 hours.
      </p>
      <p className="text-sm text-slate-500">Nothing there? Check your spam folder, or send the link again.</p>
      {state === 'sent' && <p className="text-sm text-emerald-700">A new link is on its way.</p>}
      <ErrorText error={state === 'failed' ? 'Could not send the link. Try again in a minute.' : null} />
      <Button variant="secondary" className="w-full" busy={state === 'sending'} onClick={resend}>
        Send the link again
      </Button>
    </AuthShell>
  );
}

export function AuthForm({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const router = useRouter();
  const params = useSearchParams();
  const config = useQuery({ queryKey: ['public-config'], queryFn: publicConfig, staleTime: 60_000 });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState<{ email: string; reason: 'new' | 'unconfirmed' } | null>(null);
  // Keeps OAuth (MCP sign-in) and invitation context when switching between sign-in and sign-up.
  const query = params.toString() ? `?${params.toString()}` : '';
  const next = safeNext(params.get('next'));
  const callbackURL = verifyCallback(next);
  const fromInvite = next?.startsWith('/accept-invite/') ?? false;
  // Invite-only servers accept a sign-up only with the invitation's id from its link (see apps/api auth.ts).
  const invitationId = fromInvite ? next?.slice('/accept-invite/'.length).split(/[/?#]/)[0] : undefined;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email'));
    const password = String(form.get('password'));
    setBusy(true);
    setError(null);
    const result =
      mode === 'sign-up'
        ? await authClient.signUp.email(
            { email, password, name: String(form.get('name')), callbackURL },
            invitationId ? { headers: { 'x-tcw-invitation': invitationId } } : undefined,
          )
        : await authClient.signIn.email({ email, password, callbackURL });
    if (result.error) {
      setBusy(false);
      if (result.error.code === 'EMAIL_NOT_VERIFIED') {
        setUnconfirmed({ email, reason: 'unconfirmed' });
        return;
      }
      setError(result.error.message ?? 'Something went wrong.');
      return;
    }
    // During an MCP sign-in the server answers with the next OAuth step; the auth client follows it.
    const data = result.data as { redirect?: boolean; url?: string; token?: string | null } | null;
    if (data?.redirect && data.url) return;
    // No session yet: the account exists but its email must be confirmed first.
    if (mode === 'sign-up' && !data?.token) {
      setBusy(false);
      setUnconfirmed({ email, reason: 'new' });
      return;
    }
    router.replace(next ?? '/sites');
  }

  if (unconfirmed) return <CheckInbox {...unconfirmed} callbackURL={callbackURL} />;

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
      {mode === 'sign-up' && config.data?.signupMode === 'invite' && !fromInvite && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          New accounts are by invitation. If someone invited you, open the link in your invitation and create your
          account with that email address.
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
